import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { presignPut } from "@/lib/r2"
import { logActivity } from "@/lib/activity"
import { ARCHIVE_MIME_TYPES, MAX_ARCHIVE_SIZE_BYTES } from "@/lib/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ACCEPTED_ARCHIVE_MIMES = new Set<string>(ARCHIVE_MIME_TYPES as readonly string[])

/**
 * POST /api/materials/presign
 *
 * Issues a presigned R2 PUT URL for a large archive (> 25 MB, ≤ 100 MB) and
 * inserts a placeholder `materials` row so the UI can track upload status.
 *
 * Body JSON:
 *   { title, description?, tags?, target, expiresAt?, mimeType, sizeBytes }
 *
 * Response:
 *   { uploadUrl, publicUrl, materialId, key }
 */
export async function POST(req: Request) {
  let profile: Awaited<ReturnType<typeof requireRole>>
  try {
    profile = await requireRole(["main_admin", "manager"])
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: {
    title?: string
    description?: string
    tags?: string
    target?: string
    expiresAt?: string
    mimeType?: string
    sizeBytes?: number
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { title, description, tags, target, expiresAt, mimeType, sizeBytes } = body

  // Validate title
  if (!title || title.trim().length < 2 || title.trim().length > 200) {
    return NextResponse.json({ error: "Title must be 2–200 characters." }, { status: 400 })
  }

  // Validate MIME type
  if (!mimeType || !ACCEPTED_ARCHIVE_MIMES.has(mimeType)) {
    return NextResponse.json(
      { error: `Unsupported archive type: ${mimeType ?? "(none)"}` },
      { status: 415 },
    )
  }

  // Validate size
  if (!sizeBytes || sizeBytes <= 0 || sizeBytes > MAX_ARCHIVE_SIZE_BYTES) {
    return NextResponse.json(
      {
        error: `Archive must be between 1 byte and ${Math.round(
          MAX_ARCHIVE_SIZE_BYTES / 1024 / 1024,
        )} MB.`,
      },
      { status: 413 },
    )
  }

  // Resolve team
  let teamId: string | null = null
  if (target === "global") {
    if (profile.role !== "main_admin") {
      return NextResponse.json(
        { error: "Only Main Admin can post global materials." },
        { status: 403 },
      )
    }
    teamId = null
  } else if (target) {
    if (profile.role === "manager" && target !== profile.team_id) {
      return NextResponse.json(
        { error: "Managers can only post to their own team." },
        { status: 403 },
      )
    }
    teamId = target
  } else {
    teamId = profile.team_id
  }

  // Generate R2 key
  const ext = mimeType.includes("rar") ? "rar" : "zip"
  const safeName = title
    .trim()
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 80)
  const key = `materials/${teamId ?? "global"}/${safeName}-${Date.now()}.${ext}`

  // Generate presigned PUT URL (valid for 10 minutes)
  let presignResult: { uploadUrl: string; publicUrl: string; key: string }
  try {
    presignResult = await presignPut(key, mimeType, 600)
  } catch (err: any) {
    console.error("[presign] R2 presignPut failed:", err?.message)
    return NextResponse.json({ error: "Could not generate upload URL." }, { status: 500 })
  }

  // Parse tags
  const tagList = (tags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12)

  // Insert placeholder materials row
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("materials")
    .insert({
      author_id: profile.id,
      team_id: teamId,
      title: title.trim(),
      description: description?.trim() || null,
      blob_url: presignResult.publicUrl,
      blob_pathname: key,
      file_type: mimeType,
      size_bytes: sizeBytes,
      tags: tagList,
      ...(expiresAt ? { expires_at: new Date(expiresAt).toISOString() } : {}),
      archive_status: "pending",
    } as any)
    .select("id")
    .single()

  if (error || !data) {
    console.error("[presign] DB insert failed:", error?.message)
    return NextResponse.json({ error: "Could not save material record." }, { status: 500 })
  }

  await logActivity({
    actorId: profile.id,
    teamId,
    action: "material.presign_issued",
    entityType: "material",
    entityId: data.id,
    metadata: { mime: mimeType, size: sizeBytes },
  })

  return NextResponse.json({
    uploadUrl: presignResult.uploadUrl,
    publicUrl: presignResult.publicUrl,
    materialId: data.id,
    key,
  })
}
