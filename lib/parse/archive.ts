import "server-only"
import type { ParseResult } from "@/lib/parse"

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
// RAR extraction — stub
//
// WASM-based RAR extractors (e.g. node-unrar-js) are incompatible with
// Next.js Turbopack because their .wasm loader files cannot be marked as
// serverExternalPackages.  RAR files are accepted for storage but their
// inner documents are not extracted for RAG indexing.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function* extractRar(_buf: Buffer): AsyncIterable<ArchiveEntry> {
  // Intentionally yields nothing — see comment above.
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

  if (isRar) {
    return {
      text: "",
      truncated: false,
      warning:
        "RAR text extraction is not supported in this deployment. The file has been stored and can be downloaded, but its contents are not searchable via AI.",
    }
  }

  const iterator = extractZip(buf)

  const parts: string[] = []
  let totalChars = 0
  let truncated = false
  const warnings: string[] = []

  try {
    for await (const entry of iterator) {
      let result: ParseResult
      try {
        const { extractText } = await import("@/lib/parse")
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
