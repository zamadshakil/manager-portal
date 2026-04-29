import { type NextRequest, NextResponse } from "next/server"
import { get as getBlob } from "@vercel/blob"
import { createClient } from "@/lib/supabase/server"
import { requireProfile } from "@/lib/auth"

/**
 * Authenticated proxy for submission/material files. We never expose the raw
 * Vercel Blob URL to the client — instead the UI links to
 * `/api/download/[id]?type=submission|material` which:
 *   1. resolves the row through RLS (so members see only their own,
 *      managers see their team, admin sees everything)
 *   2. fetches the unguessable Blob URL on the server
 *   3. streams the bytes back with a Content-Disposition header
 *
 * This keeps documents reasonably private even though the underlying Blob
 * objects are technically `public` (the only access mode @vercel/blob
 * supports today). Anyone without an authenticated session is bounced.
 */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const type = request.nextUrl.searchParams.get("type") ?? "submission"

  await requireProfile() // forces auth + must_reset gate via proxy
  const supabase = await createClient()

  let blobUrl: string | null = null
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
    fileName = (data.blob_pathname as string | null)?.split("/").pop() ?? (data.title as string)
    mimeType = (data.file_type as string | null) ?? "application/octet-stream"
  } else {
    const { data } = await supabase
      .from("submissions")
      .select("blob_url, blob_pathname, mime_type, title")
      .eq("id", id)
      .maybeSingle()
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 })
    blobUrl = data.blob_url as string
    fileName = (data.blob_pathname as string | null)?.split("/").pop() ?? (data.title as string)
    mimeType = (data.mime_type as string | null) ?? "application/octet-stream"
  }

  if (!blobUrl) return NextResponse.json({ error: "No file" }, { status: 404 })

  try {
    const blobResult = await getBlob(blobUrl, {
      access: "private" as const,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    })
    if (!blobResult) {
      return NextResponse.json({ error: "Blob not found" }, { status: 404 })
    }

    const safeName = (fileName ?? "download").replace(/[^\w.\-]+/g, "_")
    return new NextResponse(blobResult.stream, {
      headers: {
        "Content-Type": blobResult.blob.contentType || mimeType || "application/octet-stream",
        "Content-Disposition": `inline; filename="${safeName}"`,
        "Cache-Control": "private, max-age=0, no-store",
      },
    })
  } catch (err) {
    console.error("[download] blob fetch failed", blobUrl, err)
    return NextResponse.json(
      { error: `Upstream fetch failed: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 502 },
    )
  }
}
