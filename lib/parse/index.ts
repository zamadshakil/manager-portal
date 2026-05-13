import "server-only"
import { describeImage } from "@/lib/llm/validate"

/**
 * Native per-format extractors. Each returns plain text so the LLM stage works
 * on a uniform input. We deliberately avoid sending raw binaries to the model
 * to keep tokens predictable and inference fast — except in the explicit
 * vision fallback path.
 */

const MAX_TEXT_CHARS = 60_000

function clamp(text: string): { text: string; truncated: boolean } {
  // Postgres cannot store null bytes (\x00). Sanitize early to prevent database errors.
  const sanitizedText = text.replace(/\0/g, "")
  if (sanitizedText.length <= MAX_TEXT_CHARS) return { text: sanitizedText, truncated: false }
  return {
    text: sanitizedText.slice(0, MAX_TEXT_CHARS) + "\n\n[...truncated...]",
    truncated: true,
  }
}

export interface ParseResult {
  text: string
  pages?: number
  warning?: string
  truncated: boolean
  /** True when the text came from OCR/vision rather than native extraction. */
  fromOcr?: boolean
  /** OCR confidence 0-100 when applicable. */
  ocrConfidence?: number
}

async function parsePdf(buf: Buffer): Promise<ParseResult> {
  const { extractText, getDocumentProxy, renderPageAsImage } = await import("unpdf")
  const arr = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  const doc = await getDocumentProxy(arr)
  const result = await extractText(doc, { mergePages: true })
  let fullText = result.text ?? ""
  let pageCount = result.totalPages ?? undefined

  let fromOcr = false
  let warning: string | undefined = undefined
  let ocrConfidence: number | undefined = undefined

  // Count only letters/numbers to decide if native extraction produced real content.
  // This prevents short-text PDFs (even 1–2 words) from being wrongly treated as
  // image-only and triggering a potentially-failing OCR pass.
  const nativeReadableCount = Array.from(fullText.matchAll(/[\p{L}\p{N}]/gu)).length
  const nativeText = fullText

  // Only attempt OCR when native extraction produced zero readable characters.
  if (nativeReadableCount === 0) {
    fromOcr = true
    try {
      const maxPagesToOcr = Math.min(pageCount ?? 1, 3)
      
      let ocrText = ""

      for (let i = 1; i <= maxPagesToOcr; i++) {
        const imgBuffer = await renderPageAsImage(doc, i, {
          canvasImport: () => import("@napi-rs/canvas") as any,
          scale: 2 // Higher scale for better OCR accuracy
        })
        const imgDesc = await describeImage(new Uint8Array(imgBuffer), "image/png")
        ocrText += (imgDesc.text || "") + "\n\n"
      }

      fullText = ocrText
      ocrConfidence = undefined

      const ocrReadableCount = Array.from(fullText.matchAll(/[\p{L}\p{N}]/gu)).length
      if (ocrReadableCount === 0) {
        warning =
          "Document contains no extractable text even after OCR. It may be a scanned image with low quality or an unsupported encoding."
        // Return gracefully — the pipeline's empty-text guard will route
        // this to needs_review instead of crashing the whole submission.
        const clamped = clamp("")
        return {
          text: clamped.text,
          pages: pageCount,
          truncated: false,
          fromOcr: true,
          ocrConfidence: undefined,
          warning,
        }
      } else if ((pageCount ?? 1) > maxPagesToOcr) {
        warning = `Only the first ${maxPagesToOcr} pages were OCR'd due to performance limits.`
      }
    } catch (err: any) {
      console.warn(`[parsePdf] OCR fallback failed: ${err.message}`)
      // If native extraction had some text, use it rather than returning empty.
      if (nativeText.trim().length > 0) {
        fullText = nativeText
        fromOcr = false
      } else {
        // Truly no content — mark for review silently without a user-facing error.
        const clamped = clamp("")
        return {
          text: clamped.text,
          pages: pageCount,
          truncated: false,
          fromOcr: true,
          ocrConfidence: undefined,
          warning: undefined,
        }
      }
    }
  }

  console.log(`[parsePdf] bytes=${buf.length}, pages=${pageCount}, native_text=${result.text?.length || 0}, ocr=${fromOcr}, result_text=${fullText.length}`)

  const clamped = clamp(fullText)
  return { 
    text: clamped.text, 
    pages: pageCount, 
    truncated: clamped.truncated,
    fromOcr,
    ocrConfidence,
    warning
  }
}

async function parseDocx(buf: Buffer): Promise<ParseResult> {
  const mammoth = await import("mammoth")
  const result = await mammoth.extractRawText({ buffer: buf })
  const clamped = clamp(result.value || "")
  return {
    text: clamped.text,
    truncated: clamped.truncated,
    warning: result.messages?.[0]?.message,
  }
}

async function parseOfficeFile(buf: Buffer): Promise<ParseResult> {
  // officeparser v6+ exports `parseOffice` (not `parseOfficeAsync`).
  const { parseOffice } = await import("officeparser")
  const text = String(await parseOffice(buf))
  const clamped = clamp(text || "")
  return { text: clamped.text, truncated: clamped.truncated }
}

/**
 * Stringify an ExcelJS cell value into plain text. Handles every variant
 * (rich text, formulas, hyperlinks, dates, errors, shared formulas) so that
 * NOTHING gets silently dropped.
 */
function stringifyCellValue(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(stringifyCellValue).join(" ")

  if (typeof value === "object") {
    const v = value as Record<string, any>
    // Rich text: { richText: [{ text }, ...] }
    if (Array.isArray(v.richText)) {
      return v.richText.map((r: any) => r?.text ?? "").join("")
    }
    // Hyperlink: { text, hyperlink }
    if (typeof v.text !== "undefined" || typeof v.hyperlink !== "undefined") {
      const t = stringifyCellValue(v.text)
      const link = v.hyperlink ? ` (${v.hyperlink})` : ""
      return `${t}${link}`
    }
    // Formula: { formula, result } — prefer the computed result, else show formula.
    if (typeof v.formula !== "undefined" || typeof v.sharedFormula !== "undefined") {
      if (typeof v.result !== "undefined" && v.result !== null) {
        return stringifyCellValue(v.result)
      }
      return `=${v.formula ?? v.sharedFormula ?? ""}`
    }
    // Error cell: { error: "#REF!" }
    if (typeof v.error !== "undefined") return String(v.error)
    // Fallback: stringify object safely.
    try {
      return JSON.stringify(v)
    } catch {
      return ""
    }
  }
  return String(value)
}

async function parseExcel(buf: Buffer): Promise<ParseResult> {
  try {
    const ExcelJS = (await import("exceljs")).default
    const workbook = new ExcelJS.Workbook()
    // exceljs accepts a Node Buffer via the Uint8Array contract.
    await workbook.xlsx.load(buf as unknown as ArrayBuffer)

    const parts: string[] = []
    let totalCells = 0
    const sheetCount = workbook.worksheets.length

    for (const sheet of workbook.worksheets) {
      if (!sheet) continue
      const sheetName = sheet.name || `Sheet${sheet.id}`
      parts.push(`=== Sheet: ${sheetName} ===`)

      // eachRow with includeEmpty:false skips fully empty rows; iterate every
      // non-empty cell (including ones not in the contiguous "used range").
      sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        const rowCells: string[] = []
        row.eachCell({ includeEmpty: false }, (cell) => {
          const text = stringifyCellValue(cell.value).trim()
          if (text.length > 0) {
            rowCells.push(text)
            totalCells++
          }
        })
        if (rowCells.length > 0) {
          parts.push(`Row ${rowNumber}: ${rowCells.join(" | ")}`)
        }
      })

      // Capture merged-cell ranges metadata (helps the LLM understand layout).
      const mergeCount = (sheet as any)._merges
        ? Object.keys((sheet as any)._merges).length
        : 0
      if (mergeCount > 0) {
        parts.push(`(merged ranges: ${mergeCount})`)
      }
      parts.push("")
    }

    const text = parts.join("\n").trim()
    console.log(
      `[parseExcel] bytes=${buf.length}, sheets=${sheetCount}, cells=${totalCells}, chars=${text.length}`,
    )

    if (totalCells === 0) {
      // Workbook had no readable cells via exceljs — fall back to officeparser
      // (handles some edge formats exceljs misses, e.g. strict OOXML).
      return parseOfficeFile(buf)
    }

    const clamped = clamp(text)
    return { text: clamped.text, truncated: clamped.truncated }
  } catch (err: any) {
    console.warn(`[parseExcel] exceljs failed, falling back to officeparser: ${err?.message}`)
    return parseOfficeFile(buf)
  }
}

async function parseImage(buf: Buffer, mimeType: string): Promise<ParseResult> {
  try {
    const result = await describeImage(new Uint8Array(buf), mimeType)
    const raw = result.text || ""
    const clamped = clamp(raw)
    return {
      text: clamped.text,
      truncated: clamped.truncated,
      fromOcr: true,
      ocrConfidence: undefined,
      warning:
        raw.trim().length < 20
          ? `Vision OCR extracted little text from ${mimeType}.`
          : undefined,
    }
  } catch (err: any) {
    console.error(`[parseImage] Vision OCR failed for ${mimeType}:`, err.message)
    return {
      text: "",
      truncated: false,
      fromOcr: true,
      warning: `Image text extraction failed: ${err.message}`,
    }
  }
}

export async function extractText(buf: Buffer, mimeType: string): Promise<ParseResult> {
  switch (mimeType) {
    case "application/pdf":
      return parsePdf(buf)
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return parseDocx(buf)
    case "application/msword":
      // Legacy .doc: best-effort via officeparser.
      return parseOfficeFile(buf)
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    case "application/vnd.ms-powerpoint":
      return parseOfficeFile(buf)
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      // Modern .xlsx — exhaustive sheet/cell walk via exceljs.
      return parseExcel(buf)
    case "application/vnd.ms-excel":
      // Legacy binary .xls — exceljs can't read these, keep officeparser.
      return parseOfficeFile(buf)
    case "image/png":
    case "image/jpeg":
      return parseImage(buf, mimeType)
    case "text/plain":
    case "text/markdown":
      const txt = buf.toString("utf8")
      const clampedTxt = clamp(txt)
      return { text: clampedTxt.text, truncated: clampedTxt.truncated }
    case "application/zip":
    case "application/x-zip-compressed":
    case "application/vnd.rar":
    case "application/x-rar-compressed": {
      const { extractArchiveText } = await import("@/lib/parse/archive")
      return extractArchiveText(buf, mimeType)
    }
    default:
      return { text: "", warning: `Unsupported MIME type: ${mimeType}`, truncated: false }
  }
}
