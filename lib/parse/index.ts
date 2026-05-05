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

  // If text extraction yielded fewer than 16 characters, this is likely an image-based PDF.
  // We fall back to OCR on the first few pages (max 3 for performance).
  if (fullText.trim().length < 16) {
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

      if (fullText.trim().length < 16) {
        warning = "Document contains no extractable text even after OCR. It has been uploaded but will not be searchable."
        throw new Error(warning)
      } else if ((pageCount ?? 1) > maxPagesToOcr) {
        warning = `Only the first ${maxPagesToOcr} pages were OCR'd due to performance limits.`
      }
    } catch (err: any) {
      console.warn(`[parsePdf] OCR fallback failed: ${err.message}`)
      warning = "PDF text extraction failed and OCR fallback encountered an error. Document will not be searchable."
      throw err
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

async function parseImage(buf: Buffer, mimeType: string): Promise<ParseResult> {
  const { createWorker } = await import("tesseract.js")
  const worker = await createWorker("eng")
  try {
    const { data } = await worker.recognize(buf)
    const raw = data.text || ""
    const clamped = clamp(raw)
    const confidence = typeof data.confidence === "number" ? data.confidence : 0
    return {
      text: clamped.text,
      truncated: clamped.truncated,
      fromOcr: true,
      ocrConfidence: confidence,
      warning:
        raw.trim().length < 20
          ? `OCR extracted little text from ${mimeType}; confidence ${confidence.toFixed(0)}.`
          : undefined,
    }
  } finally {
    await worker.terminate()
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
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.ms-excel":
      return parseOfficeFile(buf)
    case "image/png":
    case "image/jpeg":
      return parseImage(buf, mimeType)
    case "text/plain":
    case "text/markdown":
      const txt = buf.toString("utf8")
      const clampedTxt = clamp(txt)
      return { text: clampedTxt.text, truncated: clampedTxt.truncated }
    default:
      return { text: "", warning: `Unsupported MIME type: ${mimeType}`, truncated: false }
  }
}
