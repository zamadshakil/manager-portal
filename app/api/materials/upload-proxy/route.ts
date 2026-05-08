import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { putRaw } from "@/lib/r2"
import { processArchiveBackground } from "@/lib/archive-processor"
import { revalidatePath } from "next/cache"
import { MAX_ARCHIVE_SIZE_BYTES } from "@/lib/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

/**
 * POST /api/materials/upload-proxy?materialId=<id>
 *
 * Accepts the raw archive bytes as the request body (Content-Type = MIME of
 * the archive) and uploads them to R2 server-side.  Using a raw body avoids
 * multipart FormData parsing, which struggles with very large files in the
 * Next.js App Router Node.js runtime.
 *
 * Query params:
 *   materialId  – the placeholder row ID created by /api/materials/presign
 *
 * On success it advances archive_status → "processing" and fires the
 * background extraction job, exactly as /api/materials/register did before.
 */
export async function POST(req: Request) {
  let profile: Awaited<ReturnType<typeof requireRole>>
  try {
    profile = await requireRole(["main_admin", "manager"])
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const materialId = searchParams.get("materialId")

  if (!materialId) {
    return NextResponse.json({ error: "materialId query param is required." }, { status: 400 })
  }

  const contentType = req.headers.get("Content-Type") || "application/zip"

  let buffer: Buffer
  try {
    buffer = Buffer.from(await req.arrayBuffer())
  } catch (err: any) {
    console.error("[upload-proxy] body read failed:", err?.message)
    return NextResponse.json({ error: "Failed to read request body." }, { status: 400 })
  }

  if (buffer.length === 0) {
    return NextResponse.json({ error: "No file data received." }, { status: 400 })
  }
  if (buffer.length > MAX_ARCHIVE_SIZE_BYTES) {
    return NextResponse.json(
      { error: `Archive exceeds the ${Math.round(MAX_ARCHIVE_SIZE_BYTES / 1024 / 1024)} MB limit.` },
      { status: 413 },
    )
  }

  const supabase = await createClient()
  const { data: row, error: fetchError } = (await supabase
    .from("materials")
    .select("*")
    .eq("id", materialId)
    .single()) as { data: any; error: any }

  if (fetchError || !row) {
    return NextResponse.json({ error: "Material not found." }, { status: 404 })
  }

  if (profile.role !== "main_admin" && row.author_id !== profile.id) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 })
  }

  if (row.archive_status !== "pending") {
    return NextResponse.json({ ok: true, materialId, alreadyUploaded: true })
  }

  try {
    await putRaw(row.blob_pathname, buffer, contentType)
  } catch (err: any) {
    console.error("[upload-proxy] R2 upload failed:", err?.message)
    return NextResponse.json({ error: "Storage upload failed." }, { status: 500 })
  }

  await supabase
    .from("materials")
    .update({ archive_status: "processing" } as any)
    .eq("id", materialId)

  void processArchiveBackground(
    materialId,
    row.blob_url,
    row.file_type ?? "application/zip",
    row.team_id ?? null,
    profile.id,
    row.title,
  )

  revalidatePath("/dashboard/materials")

  return NextResponse.json({ ok: true, materialId })
}
