import "server-only"
import { extractText, type ParseResult } from "@/lib/parse"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_DECOMPRESSED_BYTES = 500 * 1024 * 1024 // 500 MB — zip-bomb guard
const MAX_TEXT_CHARS = 60_000

// ---------------------------------------------------------------------------
// Extension → MIME map for inner archive entries
// ---------------------------------------------------------------------------

const EXT_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  txt: "text/plain",
  md: "text/markdown",
}

function mimeFromName(name: string): string | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  return EXT_TO_MIME[ext] ?? null
}

// ---------------------------------------------------------------------------
// Path sanitization — prevent traversal attacks
// ---------------------------------------------------------------------------

function sanitizeName(raw: string): string {
  return raw
    .replace(/\\/g, "/")     // normalize backslashes
    .replace(/\.\./g, "")    // strip parent-dir components
    .replace(/^\/+/, "")     // strip leading slashes
    .trim()
}

// ---------------------------------------------------------------------------
// ZIP extraction via fflate (already installed)
// ---------------------------------------------------------------------------

interface ArchiveEntry {
  name: string
  buf: Buffer
  mime: string
}

async function* extractZip(buf: Buffer): AsyncIterable<ArchiveEntry> {
  const { unzipSync } = await import("fflate")
  const arr = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)

  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(arr)
  } catch (err: any) {
    throw new Error(`ZIP extraction failed: ${err?.message ?? err}`)
  }

  let totalDecompressed = 0

  for (const [rawName, data] of Object.entries(files)) {
    // Skip directory entries
    if (rawName.endsWith("/")) continue

    // Skip nested archives (no recursion)
    if (/\.(zip|rar)$/i.test(rawName)) continue

    const name = sanitizeName(rawName)
    if (!name) continue

    const mime = mimeFromName(name)
    if (!mime) continue

    totalDecompressed += data.byteLength
    if (totalDecompressed > MAX_DECOMPRESSED_BYTES) {
      console.warn("[archive] ZIP decompressed size limit reached — aborting extraction")
      break
    }

    yield { name, buf: Buffer.from(data), mime }
  }
}

// ---------------------------------------------------------------------------
// RAR extraction via node-unrar-js (WASM, no native binary)
// ---------------------------------------------------------------------------

async function* extractRar(buf: Buffer): AsyncIterable<ArchiveEntry> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let createExtractorFromData: (...args: any[]) => Promise<any>
  try {
    const mod = await import("node-unrar-js")
    createExtractorFromData = mod.createExtractorFromData as any
  } catch (err: any) {
    throw new Error(`node-unrar-js unavailable: ${err?.message ?? err}`)
  }

  // Ensure a clean, non-shared ArrayBuffer (avoids pool-offset issues)
  const dataArr = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)

  let wasmBinary: ArrayBuffer | SharedArrayBuffer | undefined
  try {
    const { readFileSync } = await import("fs")
    const { createRequire } = await import("module")
    // ESM shim to get the package's own directory
    const req = createRequire(import.meta.url)
    const wasmPath: string = req.resolve("node-unrar-js/esm/js/unrar.wasm")
    const wasmBuf = readFileSync(wasmPath)
    wasmBinary = wasmBuf.buffer.slice(wasmBuf.byteOffset, wasmBuf.byteOffset + wasmBuf.byteLength)
  } catch {
    // Fall back: let node-unrar-js auto-locate its WASM (works in dev)
  }

  const extractor = await createExtractorFromData({
    data: dataArr as any,
    ...(wasmBinary ? { wasmBinary: wasmBinary as any } : {}),
  })

  const list = extractor.getFileList()
  const fileHeaders: any[] = [...list.fileHeaders]

  const extracted = extractor.extract({
    files: fileHeaders.map((h: any) => h.name),
  })

  let totalDecompressed = 0

  for (const file of extracted.files) {
    const { fileHeader, extraction } = file as {
      fileHeader: { name: string; flags?: { directory?: boolean } }
      extraction?: Uint8Array
    }

    // Skip directories and failed extractions
    if (!extraction) continue
    if (fileHeader.flags?.directory) continue

    const rawName = fileHeader.name
    if (/\.(zip|rar)$/i.test(rawName)) continue

    const name = sanitizeName(rawName)
    if (!name) continue

    const mime = mimeFromName(name)
    if (!mime) continue

    totalDecompressed += extraction.byteLength
    if (totalDecompressed > MAX_DECOMPRESSED_BYTES) {
      console.warn("[archive] RAR decompressed size limit reached — aborting extraction")
      break
    }

    yield { name, buf: Buffer.from(extraction), mime }
  }
}

// ---------------------------------------------------------------------------
// Public API — extractArchiveText
// ---------------------------------------------------------------------------

/**
 * Extracts text from all supported inner documents of a ZIP or RAR archive.
 * Concatenates results with separator lines, then clamps to MAX_TEXT_CHARS.
 */
export async function extractArchiveText(
  buf: Buffer,
  mimeType: string,
): Promise<ParseResult> {
  const isRar =
    mimeType === "application/vnd.rar" ||
    mimeType === "application/x-rar-compressed"

  const iterator = isRar ? extractRar(buf) : extractZip(buf)

  const parts: string[] = []
  let totalChars = 0
  let truncated = false
  const warnings: string[] = []

  try {
    for await (const entry of iterator) {
      let result: ParseResult
      try {
        result = await extractText(entry.buf, entry.mime)
      } catch (err: any) {
        warnings.push(`${entry.name}: extraction failed (${err?.message ?? err})`)
        continue
      }

      if (result.warning) warnings.push(`${entry.name}: ${result.warning}`)
      if (!result.text.trim()) continue

      const header = `\n[--- ${entry.name} ---]\n`
      const segment = header + result.text

      if (totalChars + segment.length > MAX_TEXT_CHARS) {
        const remaining = MAX_TEXT_CHARS - totalChars
        if (remaining > header.length) {
          parts.push(segment.slice(0, remaining) + "\n\n[...truncated...]")
        }
        truncated = true
        break
      }

      parts.push(segment)
      totalChars += segment.length
    }
  } catch (err: any) {
    return {
      text: "",
      truncated: false,
      warning: `Archive extraction failed: ${err?.message ?? err}`,
    }
  }

  const text = parts.join("").replace(/\0/g, "")

  return {
    text,
    truncated,
    warning: warnings.length ? warnings.slice(0, 3).join("; ") : undefined,
  }
}
