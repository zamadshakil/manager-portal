/**
 * Native per-format extractors. Each returns plain text so the LLM stage works
 * on a uniform input. We deliberately avoid sending raw binaries to the model
 * to keep tokens predictable and inference fast.
 */

const MAX_TEXT_CHARS = 60_000

function clamp(text: string): string {
  if (text.length <= MAX_TEXT_CHARS) return text
  return text.slice(0, MAX_TEXT_CHARS) + "\n\n[...truncated...]"
}

export interface ParseResult {
  text: string
  pages?: number
  warning?: string
}

async function parsePdf(buf: Buffer): Promise<ParseResult> {
  const mod = (await import("pdf-parse")) as unknown as {
    default: (b: Buffer) => Promise<{ text: string; numpages: number }>
  }
  const result = await mod.default(buf)
  return { text: clamp(result.text || ""), pages: result.numpages }
}

async function parseDocx(buf: Buffer): Promise<ParseResult> {
  const mammoth = await import("mammoth")
  const result = await mammoth.extractRawText({ buffer: buf })
  return { text: clamp(result.value || ""), warning: result.messages?.[0]?.message }
}

async function parsePptx(buf: Buffer): Promise<ParseResult> {
  const officeparser = (await import("officeparser")) as unknown as {
    parseOfficeAsync: (b: Buffer) => Promise<string>
  }
  const text = await officeparser.parseOfficeAsync(buf)
  return { text: clamp(text || "") }
}

async function parseImage(buf: Buffer, mimeType: string): Promise<ParseResult> {
  const { createWorker } = await import("tesseract.js")
  const worker = await createWorker("eng")
  try {
    const { data } = await worker.recognize(buf)
    const text = data.text || ""
    return {
      text: clamp(text),
      warning: text.trim().length < 20 ? `OCR found little text in ${mimeType}` : undefined,
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
      return { text: "", warning: `Unsupported MIME type: ${mimeType}` }
  }
}
