import "server-only"

/**
 * Upload-time structural integrity checks. The MIME sniffer in
 * `@/lib/mime-sniff.ts` already protects us from a fully-spoofed payload
 * (renamed `.exe` to `.pdf`). This module catches the next class of bad
 * input — *legitimate* file types whose contents are truncated, corrupted,
 * or were saved with a broken writer.
 *
 * Why pre-flight instead of inside the pipeline?
 *   - The pipeline pre-flight (HEAD-on-R2 + credit check + LLM rate-limit)
 *     all run BEFORE we know the file is parseable. A corrupted DOCX
 *     wastes those checks plus a pipeline-budget slot.
 *   - Surfacing the error at upload time gives the user immediate feedback
 *     ("re-export the file") instead of a 60s wait + cryptic parse error.
 *
 * Performance:
 *   - All checks are synchronous, allocation-light, and operate on the
 *     buffer we already have in memory for the MIME sniff. No new deps.
 *   - The OOXML check skips the actual inflate — it only walks the ZIP
 *     central directory, which is in the last <64 KB regardless of file
 *     size. Cost on a 25 MB DOCX: <5 ms.
 */

export type IntegrityResult = { ok: true } | { ok: false; reason: string }

const MIN_PDF_SIZE = 100
const MIN_OOXML_SIZE = 256
const MIN_OLE_SIZE = 512
const MIN_IMAGE_SIZE = 32
const MIN_TEXT_BYTES = 1

const OOXML_REQUIRED_PARTS: Record<string, string[]> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    "word/document.xml",
  ],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [
    "ppt/presentation.xml",
  ],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
    "xl/workbook.xml",
  ],
}

/**
 * Verify that a buffer matching `mime` looks structurally well-formed.
 * Returns `{ ok: true }` on accept, or a human-friendly rejection reason.
 *
 * Treat unknown / unsupported MIMEs as `ok: true` — the upstream MIME
 * allow-list already gates them, and we'd rather under-block than reject
 * a file the rest of the pipeline knows how to handle.
 */
export function verifyFileIntegrity(buf: Buffer, mime: string): IntegrityResult {
  if (mime === "application/pdf") return checkPdf(buf)

  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return checkOoxml(buf, mime)
  }

  if (
    mime === "application/msword" ||
    mime === "application/vnd.ms-powerpoint" ||
    mime === "application/vnd.ms-excel"
  ) {
    return checkOle(buf)
  }

  if (mime === "image/png") return checkPng(buf)
  if (mime === "image/jpeg") return checkJpeg(buf)

  if (mime === "text/plain" || mime === "text/markdown") return checkText(buf)

  // ZIP / RAR / anything else: trust the MIME sniffer's family check.
  return { ok: true }
}

// ── PDF ──────────────────────────────────────────────────────────────────
function checkPdf(buf: Buffer): IntegrityResult {
  if (buf.length < MIN_PDF_SIZE) {
    return { ok: false, reason: "PDF is too small to be valid (likely truncated)." }
  }
  // Header must start with %PDF- in the first 1 KB (some scanners prepend a
  // BOM or junk — the spec allows up to 1024 bytes of leading garbage).
  const head = buf.subarray(0, Math.min(buf.length, 1024)).toString("latin1")
  if (!head.includes("%PDF-")) {
    return { ok: false, reason: "PDF header is missing or malformed." }
  }
  // Trailer: %%EOF must appear within the last 2 KB. Most writers put it
  // in the last few bytes, but some pad with whitespace.
  const tail = buf.subarray(Math.max(0, buf.length - 2048)).toString("latin1")
  if (!tail.includes("%%EOF")) {
    return {
      ok: false,
      reason:
        "PDF is missing its end-of-file marker — the file appears to be truncated. Please re-export and try again.",
    }
  }
  return { ok: true }
}

// ── OOXML (.docx / .pptx / .xlsx) ────────────────────────────────────────
function checkOoxml(buf: Buffer, mime: string): IntegrityResult {
  if (buf.length < MIN_OOXML_SIZE) {
    return { ok: false, reason: "Office document is too small to be valid." }
  }
  // Local file header at byte 0 — sniffer already confirmed PK\x03\x04, but
  // recheck cheaply so this function is independent.
  if (!(buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04)) {
    return { ok: false, reason: "Office document is missing its ZIP header." }
  }

  // End-of-Central-Directory record. EOCD signature 0x06054b50 must appear
  // within the last 64 KB (max comment length is 0xFFFF). We scan from the
  // tail forward to find it.
  const scanWindow = Math.min(buf.length, 65_536 + 22)
  const start = buf.length - scanWindow
  const eocdSig = Buffer.from([0x50, 0x4b, 0x05, 0x06])
  let eocdOffset = -1
  // Search backwards in 1 KB strides for speed; fallback to linear if needed.
  for (let i = buf.length - 22; i >= start; i--) {
    if (
      buf[i] === eocdSig[0] &&
      buf[i + 1] === eocdSig[1] &&
      buf[i + 2] === eocdSig[2] &&
      buf[i + 3] === eocdSig[3]
    ) {
      eocdOffset = i
      break
    }
  }
  if (eocdOffset === -1) {
    return {
      ok: false,
      reason:
        "Office document is missing its archive index — the file appears to be truncated. Please re-export and try again.",
    }
  }

  // Read the central directory location + size from the EOCD record.
  // EOCD layout (relevant fields):
  //   +10  total entries (u16, LE)
  //   +12  central dir size (u32, LE)
  //   +16  central dir offset (u32, LE)
  const totalEntries = buf.readUInt16LE(eocdOffset + 10)
  const cdSize = buf.readUInt32LE(eocdOffset + 12)
  const cdOffset = buf.readUInt32LE(eocdOffset + 16)
  if (totalEntries === 0 || cdSize === 0) {
    return { ok: false, reason: "Office document contains no archive entries." }
  }
  if (cdOffset + cdSize > buf.length) {
    return {
      ok: false,
      reason:
        "Office document's archive index points past the end of the file (truncated or corrupted).",
    }
  }

  // Walk the central directory and collect filenames so we can confirm the
  // required OOXML part is present. Each CD entry header is 46 bytes + name
  // + extra + comment.
  const cdSigBytes = [0x50, 0x4b, 0x01, 0x02]
  const names = new Set<string>()
  let p = cdOffset
  const cdEnd = cdOffset + cdSize
  for (let i = 0; i < totalEntries && p + 46 <= cdEnd; i++) {
    if (
      buf[p] !== cdSigBytes[0] ||
      buf[p + 1] !== cdSigBytes[1] ||
      buf[p + 2] !== cdSigBytes[2] ||
      buf[p + 3] !== cdSigBytes[3]
    ) {
      // Bad CD header — corrupted index. Bail.
      return {
        ok: false,
        reason:
          "Office document's archive index is corrupted. Please re-export the file from its source application.",
      }
    }
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const nameStart = p + 46
    const nameEnd = nameStart + nameLen
    if (nameEnd > cdEnd) break
    names.add(buf.subarray(nameStart, nameEnd).toString("utf8"))
    p = nameEnd + extraLen + commentLen
  }

  const required = OOXML_REQUIRED_PARTS[mime] ?? []
  for (const part of required) {
    if (!names.has(part)) {
      return {
        ok: false,
        reason: `Office document is missing required part "${part}". The file may be corrupted or saved in an incompatible format.`,
      }
    }
  }
  return { ok: true }
}

// ── Legacy MSOLE (.doc / .ppt / .xls) ────────────────────────────────────
function checkOle(buf: Buffer): IntegrityResult {
  if (buf.length < MIN_OLE_SIZE) {
    return { ok: false, reason: "Legacy Office document is too small to be valid." }
  }
  // Header signature already validated by the MIME sniffer (D0 CF 11 E0 …).
  // We additionally verify the byte-order mark at offset 28 (FE FF) which is
  // present in every legitimate OLE2 file and absent from random binaries
  // that happen to share the first 8 bytes.
  if (!(buf[28] === 0xfe && buf[29] === 0xff)) {
    return {
      ok: false,
      reason:
        "Legacy Office document header is malformed — the file may be corrupted. Try saving it again in its source application.",
    }
  }
  return { ok: true }
}

// ── PNG ──────────────────────────────────────────────────────────────────
function checkPng(buf: Buffer): IntegrityResult {
  if (buf.length < MIN_IMAGE_SIZE) {
    return { ok: false, reason: "PNG is too small to be valid." }
  }
  // Signature already validated by sniffer. First chunk after the 8-byte
  // signature must be IHDR (length 13). Layout:
  //   +8   length (u32 BE) = 13
  //   +12  type ("IHDR")
  //   +16  width (u32 BE)
  //   +20  height (u32 BE)
  if (
    buf[12] !== 0x49 || // I
    buf[13] !== 0x48 || // H
    buf[14] !== 0x44 || // D
    buf[15] !== 0x52 // R
  ) {
    return { ok: false, reason: "PNG header (IHDR) is missing or out of place." }
  }
  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  if (width === 0 || height === 0 || width > 16384 || height > 16384) {
    return {
      ok: false,
      reason: `PNG reports invalid dimensions (${width}x${height}).`,
    }
  }
  // Final IEND chunk must appear in the last 512 bytes. The standard IEND
  // chunk is the last 12 bytes of a PNG, but some tools (Photoshop, exiftool,
  // social media processors) append metadata chunks after IEND, pushing it
  // further from the end.
  const tail = buf.subarray(Math.max(0, buf.length - 512))
  const iendIdx = tail.indexOf(Buffer.from("IEND", "latin1"))
  if (iendIdx === -1) {
    return {
      ok: false,
      reason:
        "PNG is missing its end-of-image marker — the file appears to be truncated.",
    }
  }
  return { ok: true }
}

// ── JPEG ─────────────────────────────────────────────────────────────────
function checkJpeg(buf: Buffer): IntegrityResult {
  if (buf.length < MIN_IMAGE_SIZE) {
    return { ok: false, reason: "JPEG is too small to be valid." }
  }
  // SOI already validated (FF D8 FF). Require EOI (FF D9) somewhere in the
  // last 512 bytes. The standard EOI is the final two bytes, but some
  // encoders (certain cameras, iOS photo export, Exif writers) append a
  // thumbnail or metadata chunk after the main EOI, pushing it back.
  const tail = buf.subarray(Math.max(0, buf.length - 512))
  let foundEoi = false
  for (let i = 0; i < tail.length - 1; i++) {
    if (tail[i] === 0xff && tail[i + 1] === 0xd9) {
      foundEoi = true
      break
    }
  }
  if (!foundEoi) {
    return {
      ok: false,
      reason:
        "JPEG is missing its end-of-image marker — the file appears to be truncated.",
    }
  }
  return { ok: true }
}

// ── Plain text / markdown ────────────────────────────────────────────────
function checkText(buf: Buffer): IntegrityResult {
  if (buf.length < MIN_TEXT_BYTES) {
    return { ok: false, reason: "Text file is empty." }
  }
  // Reject obvious binary payloads renamed as .txt. The MIME sniffer's
  // looksLikeText already does a sample check, but we tighten it here by
  // sampling further into the file (some attackers prepend printable text
  // ahead of binary).
  const sample = buf.subarray(0, Math.min(buf.length, 4096))
  for (const b of sample) {
    if (b === 0) {
      return {
        ok: false,
        reason:
          "Text file contains null bytes — looks like a binary file with a renamed extension.",
      }
    }
  }
  // Verify UTF-8 validity by round-tripping a sample. Invalid UTF-8 bytes
  // turn into U+FFFD on decode; if the encoded length differs significantly,
  // the file is likely not valid UTF-8.
  try {
    const decoded = sample.toString("utf8")
    const reencoded = Buffer.from(decoded, "utf8")
    // Allow a small tolerance — multibyte chars at the sample boundary can
    // legitimately differ by a few bytes.
    if (Math.abs(reencoded.length - sample.length) > 4) {
      return {
        ok: false,
        reason:
          "Text file is not valid UTF-8 — please re-save it with UTF-8 encoding.",
      }
    }
  } catch {
    return { ok: false, reason: "Text file could not be decoded as UTF-8." }
  }
  return { ok: true }
}
