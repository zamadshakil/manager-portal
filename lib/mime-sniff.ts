import "server-only"

/**
 * Lightweight magic-byte sniffer for the file types we accept in submissions
 * and materials. The browser-supplied `file.type` is trivial to spoof — a
 * malicious user can rename `payload.exe` to `report.pdf` and the upload
 * action would happily accept it. Sniffing the first ~16 bytes catches the
 * common cases without pulling in `file-type` (which is ESM-only and adds
 * 200KB+ for what we need).
 *
 * Strategy:
 *   1. Map magic-byte signatures to a *family* of MIME types (e.g. ZIP-based
 *      OOXML files all start with `PK\x03\x04`, so DOCX/PPTX/XLSX/ZIP share
 *      the same family).
 *   2. The caller compares the sniffed family against the claimed MIME's
 *      family. A claim that doesn't match any signature for the family
 *      → MIME spoof, reject.
 *
 * Plain-text files (txt, md) have no signature, so we treat them as
 * "always-acceptable" and only enforce printable-ASCII characters.
 */

type MimeFamily =
  | "pdf"
  | "msole" // legacy .doc / .ppt / .xls (OLE2 compound)
  | "ooxml" // ZIP-based docx / pptx / xlsx
  | "zip" // generic zip
  | "rar"
  | "png"
  | "jpeg"
  | "text" // plain text / markdown
  | "unknown"

const MIME_TO_FAMILY: Record<string, MimeFamily> = {
  "application/pdf": "pdf",
  "application/msword": "msole",
  "application/vnd.ms-powerpoint": "msole",
  "application/vnd.ms-excel": "msole",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "ooxml",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "ooxml",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "ooxml",
  "application/zip": "zip",
  "application/x-zip-compressed": "zip",
  "application/vnd.rar": "rar",
  "application/x-rar-compressed": "rar",
  "image/png": "png",
  "image/jpeg": "jpeg",
  "text/plain": "text",
  "text/markdown": "text",
}

function startsWith(buf: Buffer, sig: number[]): boolean {
  if (buf.length < sig.length) return false
  for (let i = 0; i < sig.length; i++) {
    if (buf[i] !== sig[i]) return false
  }
  return true
}

function looksLikeText(buf: Buffer): boolean {
  // Sample up to first 1KB. If >95% bytes are printable ASCII (incl tab/lf/cr)
  // and there are no NUL bytes in the sample, it's plausibly text.
  const sample = buf.subarray(0, Math.min(buf.length, 1024))
  if (sample.length === 0) return true
  let printable = 0
  for (const b of sample) {
    if (b === 0) return false
    if (b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b < 0x7f) || b >= 0x80) {
      printable++
    }
  }
  return printable / sample.length >= 0.95
}

/**
 * Identify the family of a buffer based on its magic bytes. Returns
 * `"unknown"` if no signature matched (text files often hit this branch).
 */
export function sniffMimeFamily(buf: Buffer): MimeFamily {
  // PDF: "%PDF-"
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png"
  // JPEG: FF D8 FF
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "jpeg"
  // ZIP / OOXML: "PK\x03\x04" (also "PK\x05\x06" for empty zip, "PK\x07\x08")
  if (
    startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(buf, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(buf, [0x50, 0x4b, 0x07, 0x08])
  ) {
    return "ooxml" // also covers zip — caller decides via claimed MIME
  }
  // RAR v1.5: "Rar!\x1a\x07\x00"; RAR v5: "Rar!\x1a\x07\x01\x00"
  if (
    startsWith(buf, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]) ||
    startsWith(buf, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00])
  ) {
    return "rar"
  }
  // OLE2 / CFB compound document (legacy doc/ppt/xls): D0 CF 11 E0 A1 B1 1A E1
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "msole"

  // No magic match — fall back to a text plausibility check. Any binary
  // payload renamed to .txt would fail this.
  if (looksLikeText(buf)) return "text"

  return "unknown"
}

/**
 * Given a buffer and a claimed MIME, decide whether the bytes match the
 * claim. Returns `null` on accept, or a human-readable rejection reason.
 *
 * Special cases:
 *   - "ooxml" sniff matches ANY zip-family claim (zip, docx, pptx, xlsx).
 *     We can't distinguish OOXML sub-types without parsing the archive,
 *     and our pipeline already routes by the claimed MIME downstream.
 *   - Text claims accept any "looksLikeText" buffer.
 */
export function verifyMimeAgainstBuffer(
  buf: Buffer,
  claimedMime: string,
): { ok: true } | { ok: false; reason: string } {
  const claimedFamily = MIME_TO_FAMILY[claimedMime]
  if (!claimedFamily) {
    return { ok: false, reason: `Unsupported MIME type: ${claimedMime}` }
  }

  const sniffed = sniffMimeFamily(buf)

  if (sniffed === "unknown") {
    // No magic bytes recognised AND not text-like → reject.
    return {
      ok: false,
      reason:
        "The uploaded file's contents do not match its claimed type. The file may be corrupted or renamed from a different format.",
    }
  }

  // Compatibility: ooxml-family magic bytes are valid for both ooxml and
  // zip claims (since ooxml IS zip).
  if (sniffed === "ooxml" && (claimedFamily === "ooxml" || claimedFamily === "zip")) {
    return { ok: true }
  }

  // For the simple cases the families must match exactly.
  if (sniffed === claimedFamily) return { ok: true }

  return {
    ok: false,
    reason: `The file's contents (sniffed as "${sniffed}") do not match the claimed type "${claimedMime}". Please upload the file in its original format.`,
  }
}
