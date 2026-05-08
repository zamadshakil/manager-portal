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
 * POST /api/materials/upload-proxy
 *
 * Accepts the archive file from the browser as multipart FormData and uploads
 * it to R2 server-side, bypassing the browser-to-R2 direct upload that
 * requires CORS headers on the bucket.
 *
 * FormData fields:
 *   materialId  – the placeholder row ID created by /api/materials/presign
 *   file        – the archive blob
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

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 })
  }

  const materialId = formData.get("materialId") as string | null
  const file = formData.get("file") as File | null

  if (!materialId) {
    return NextResponse.json({ error: "materialId is required." }, { status: 400 })
  }
  if (!file || file.size === 0) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 })
  }
  if (file.size > MAX_ARCHIVE_SIZE_BYTES) {
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
    const buffer = Buffer.from(await file.arrayBuffer())
    await putRaw(row.blob_pathname, buffer, file.type || "application/zip")
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
