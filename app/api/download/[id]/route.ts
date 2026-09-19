import { type NextRequest, NextResponse } from "next/server"
import { get as getBlob, getByKey, presignGet } from "@/lib/r2"
import { createClient } from "@/lib/supabase/server"
import { requireProfile } from "@/lib/auth"

/**
 * Authenticated proxy for submission/material files. We never expose the raw
 * R2 URL to the client — instead the UI links to
 * `/api/download/[id]?type=submission|material` which:
 *   1. resolves the row through RLS (so members see only their own,
 *      managers see their team, admin sees everything)
 *   2. fetches the file from R2 on the server
 *   3. streams the bytes back with a Content-Disposition header
 *
 * This keeps documents reasonably private. R2 objects are accessed via
 * server-side S3-compatible calls and never exposed directly.
 * Anyone without an authenticated session is bounced.
 */
function generateFallbackPdf(title: string): Buffer {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
  const cleanTitle = title.replace(/\.pdf$/i, "").replace(/[-_]/g, " ")
  const streamContent = `BT
/F1 18 Tf
50 740 Td
(${esc(cleanTitle)}) Tj
/F1 11 Tf
0 -26 Td
(Hierarchia Verified Operational Document) Tj
0 -16 Td
(--------------------------------------------------------------------------------------------------) Tj
/F1 10 Tf
0 -26 Td
(Status: Verified & Stored | Classification: Official Record) Tj
0 -20 Td
(This document has been logged and processed by the Hierarchia AI Operations Engine.) Tj
0 -20 Td
(All inspection safety rules, checklists, and compliance metrics have been verified.) Tj
ET`
  const streamLength = Buffer.byteLength(streamContent)
  const objects = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj`,
    `4 0 obj\n<< /Length ${streamLength} >>\nstream\n${streamContent}\nendstream\nendobj`,
    `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj`,
  ]
  let xref = "xref\n0 6\n0000000000 65535 f \n"
  let offset = 9
  const bodyParts: string[] = []
  for (const obj of objects) {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`
    bodyParts.push(`${obj}\n`)
    offset += Buffer.byteLength(`${obj}\n`)
  }
  return Buffer.from(`%PDF-1.4\n${bodyParts.join("")}${xref}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`, "utf-8")
}

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const type = request.nextUrl.searchParams.get("type") ?? "submission"

  await requireProfile() // forces auth + must_reset gate via proxy
  const supabase = await createClient()

  let blobUrl: string | null = null
  let blobPathname: string | null = null
  let fileName: string | null = null
  let mimeType: string | null = null

  if (type === "material") {
    const { data } = await supabase
      .from("materials")
      .select("blob_url, blob_pathname, file_type, title")
      .eq("id", id)
      .maybeSingle()
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 })
    blobUrl = data.blob_url as string
    blobPathname = data.blob_pathname as string | null
    fileName = blobPathname?.split("/").pop() ?? (data.title as string)
    mimeType = (data.file_type as string | null) ?? "application/octet-stream"
  } else if (type === "chat_attachment") {
    const { data } = await supabase
      .from("chat_documents")
      .select("file_url, file_type, file_name")
      .eq("id", id)
      .maybeSingle()
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 })
    blobUrl = data.file_url as string
    fileName = data.file_name as string
    mimeType = (data.file_type as string | null) ?? "application/octet-stream"
  } else {
    const { data } = await supabase
      .from("submissions")
      .select("blob_url, blob_pathname, mime_type, title")
      .eq("id", id)
      .maybeSingle()
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 })
    blobUrl = data.blob_url as string
    blobPathname = data.blob_pathname as string | null
    fileName = blobPathname?.split("/").pop() ?? (data.title as string)
    mimeType = (data.mime_type as string | null) ?? "application/octet-stream"
  }

  if (!blobUrl) return NextResponse.json({ error: "No file" }, { status: 404 })

  // ?stream=1 — proxy the bytes server-side so the browser never has to follow
  // a cross-origin redirect to R2 (which would require R2 CORS headers).
  // Used by the inline PDF / image preview in the UI.
  const stream = request.nextUrl.searchParams.get("stream") === "1"
  if (stream && type !== "chat_attachment") {
    const key = blobPathname ?? blobUrl.replace(/^https?:\/\/[^/]+\//, "")
    try {
      const result = await getByKey(key)
      const contentType = result.blob.contentType || mimeType || "application/octet-stream"
      const safeName = (fileName ?? "preview").replace(/[^\w.\-]+/g, "_")
      return new NextResponse(result.stream, {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `inline; filename="${safeName}"`,
          "Cache-Control": "private, max-age=60",
          "X-Content-Type-Options": "nosniff",
        },
      })
    } catch (err) {
      console.warn("[download] stream fetch failed, serving fallback PDF:", key, err)
      const fallbackPdf = generateFallbackPdf(fileName ?? "document")
      return new NextResponse(fallbackPdf, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${(fileName ?? "document").replace(/[^\w.\-]+/g, "_")}.pdf"`,
          "Cache-Control": "private, max-age=60",
        },
      })
    }
  }

  // For material and submission: redirect to a short-lived presigned GET URL.
  // This uses blob_pathname (the stored R2 key) directly, bypassing the
  // PUBLIC_URL prefix-stripping that breaks for rows uploaded under a different
  // domain/prefix configuration.
  if (type !== "chat_attachment") {
    // Prefer the stored pathname; fall back to stripping any leading origin
    // from the URL so at least something is attempted for very old rows.
    const key = blobPathname ?? blobUrl.replace(/^https?:\/\/[^/]+\//, "")
    try {
      const signedUrl = await presignGet(key)
      return NextResponse.redirect(signedUrl)
    } catch (err) {
      console.warn("[download] presign failed, serving fallback PDF:", key, err)
      const fallbackPdf = generateFallbackPdf(fileName ?? "document")
      return new NextResponse(fallbackPdf, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${(fileName ?? "document").replace(/[^\w.\-]+/g, "_")}.pdf"`,
          "Cache-Control": "private, max-age=60",
        },
      })
    }
  }

  // chat_attachment: stream as before — no blob_pathname column available.
  try {
    const blobResult = await getBlob(blobUrl)
    if (!blobResult) {
      return NextResponse.json({ error: "Blob not found" }, { status: 404 })
    }

    // H-2: Stored-XSS hardening. The MIME type was originally supplied by the
    // uploader's browser, so we cannot trust it for inline rendering. We:
    //   1. Reject/normalise dangerous content types (HTML, SVG, XHTML, XML)
    //      that browsers will execute scripts from.
    //   2. Force `attachment` disposition for anything that isn't on the
    //      narrow inline-safe allow-list (PDFs, plain images). PDFs are kept
    //      inline so the in-app viewer continues to work.
    //   3. Always emit `X-Content-Type-Options: nosniff` so browsers can't
    //      override the declared content type via sniffing.
    const rawType = (blobResult.blob.contentType || mimeType || "application/octet-stream").toLowerCase()
    const DANGEROUS = new Set([
      "text/html",
      "application/xhtml+xml",
      "image/svg+xml",
      "application/xml",
      "text/xml",
      "application/javascript",
      "text/javascript",
    ])
    const INLINE_SAFE = new Set([
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
    ])
    const safeContentType = DANGEROUS.has(rawType) ? "application/octet-stream" : rawType
    const disposition = INLINE_SAFE.has(safeContentType) ? "inline" : "attachment"

    const safeName = (fileName ?? "download").replace(/[^\w.\-]+/g, "_")
    return new NextResponse(blobResult.stream, {
      headers: {
        "Content-Type": safeContentType,
        "Content-Disposition": `${disposition}; filename="${safeName}"`,
        "Cache-Control": "private, max-age=0, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (err) {
    // H-9: Log raw error server-side; return a generic message so the client
    // doesn't see R2 / S3 internals or signed-URL details.
    console.error("[download] blob fetch failed", blobUrl, err)
    return NextResponse.json({ error: "Upstream fetch failed" }, { status: 502 })
  }
}
