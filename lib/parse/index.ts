import "server-only"

/**
 * Native per-format extractors. Each returns plain text so the LLM stage works
 * on a uniform input. We deliberately avoid sending raw binaries to the model
 * to keep tokens predictable and inference fast — except in the explicit
 * vision fallback path.
 */

const MAX_TEXT_CHARS = 60_000

function clamp(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_TEXT_CHARS) return { text, truncated: false }
  return {
    text: text.slice(0, MAX_TEXT_CHARS) + "\n\n[...truncated...]",
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
  // pdf-parse v2 uses a class-based API — the old v1 subpath import no longer works.
  const { PDFParse } = await import("pdf-parse")
  const parser = new PDFParse({ data: buf })
  const result = await parser.getText()
  await parser.destroy()
  // result is { pages: [...], text: string, total: number }
  const fullText = typeof result === "string" ? result : (result as { text?: string }).text ?? ""
  const pageCount = Array.isArray((result as { pages?: unknown[] }).pages)
    ? (result as { pages: unknown[] }).pages.length
    : undefined
  const clamped = clamp(fullText)
  return { text: clamped.text, pages: pageCount, truncated: clamped.truncated }
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

async function parsePptx(buf: Buffer): Promise<ParseResult> {
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
      return parsePptx(buf)
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    case "application/vnd.ms-powerpoint":
      return parsePptx(buf)
    case "image/png":
    case "image/jpeg":
      return parseImage(buf, mimeType)
    default:
      return { text: "", warning: `Unsupported MIME type: ${mimeType}`, truncated: false }
  }
}
