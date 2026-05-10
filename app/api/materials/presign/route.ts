import { NextResponse } from "next/server"
import { requireProfile } from "@/lib/auth"
import { AccessDeniedError, assertCapability, CAPABILITIES } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"
import { presignPut } from "@/lib/r2"
import { logActivity } from "@/lib/activity"
import { enforceApiRateLimit } from "@/lib/api-rate-limit"
import {
  ARCHIVE_MIME_TYPES,
  MAX_MATERIAL_UPLOAD_SIZE_BYTES,
  normalizeMaterialMimeType,
} from "@/lib/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ARCHIVE_MIMES = new Set<string>(ARCHIVE_MIME_TYPES as readonly string[])

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
  const limited = await enforceApiRateLimit(req, {
    prefix: "api:materials:presign",
    limit: 30,
    windowMs: 60_000,
  })
  if (limited) return limited

  let profile: Awaited<ReturnType<typeof requireProfile>>
  try {
    profile = await requireProfile()
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: {
    title?: string
    fileName?: string
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

  const { title, fileName, description, tags, target, expiresAt, mimeType, sizeBytes } = body

  // Validate title
  if (!title || title.trim().length < 2 || title.trim().length > 200) {
    return NextResponse.json({ error: "Title must be 2–200 characters." }, { status: 400 })
  }

  if (!fileName || !fileName.trim()) {
    return NextResponse.json({ error: "fileName is required." }, { status: 400 })
  }

  const resolvedMimeType = normalizeMaterialMimeType(fileName, mimeType)

  // Validate MIME type
  if (!resolvedMimeType) {
    return NextResponse.json(
      { error: `Unsupported file type: ${mimeType ?? "(none)"}` },
      { status: 415 },
    )
  }

  // Validate size
  if (!sizeBytes || sizeBytes <= 0 || sizeBytes > MAX_MATERIAL_UPLOAD_SIZE_BYTES) {
    return NextResponse.json(
      {
        error: `File must be between 1 byte and ${Math.round(
          MAX_MATERIAL_UPLOAD_SIZE_BYTES / 1024 / 1024,
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
    try {
      await assertCapability(profile, CAPABILITIES.MATERIALS_CREATE, {
        team_id: target,
        is_global: false,
      })
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        return NextResponse.json(
          { error: "You do not have permission to upload materials for this team." },
          { status: 403 },
        )
      }
      throw err
    }
    teamId = target
  } else {
    if (!profile.team_id) {
      return NextResponse.json({ error: "No team assigned." }, { status: 403 })
    }
    teamId = profile.team_id
  }

  // Generate R2 key
  const fileExt = fileName.split(".").pop()?.trim().toLowerCase()
  const ext = fileExt && /^[a-z0-9]+$/.test(fileExt)
    ? fileExt
    : resolvedMimeType.includes("presentation")
      ? "pptx"
      : resolvedMimeType.includes("powerpoint")
        ? "ppt"
        : resolvedMimeType.includes("wordprocessingml")
          ? "docx"
          : resolvedMimeType.includes("msword")
            ? "doc"
            : resolvedMimeType.includes("spreadsheetml")
              ? "xlsx"
              : resolvedMimeType.includes("excel")
                ? "xls"
                : resolvedMimeType.includes("pdf")
                  ? "pdf"
                  : resolvedMimeType.includes("markdown")
                    ? "md"
                    : resolvedMimeType.includes("plain")
                      ? "txt"
                      : resolvedMimeType.includes("png")
                        ? "png"
                        : resolvedMimeType.includes("jpeg")
                          ? "jpg"
                          : resolvedMimeType.includes("rar")
                            ? "rar"
                            : "zip"
  const safeName = title
    .trim()
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 80)
  const key = `materials/${teamId ?? "global"}/${safeName}-${Date.now()}.${ext}`

  // Generate presigned PUT URL (valid for 10 minutes)
  let presignResult: { uploadUrl: string; publicUrl: string; key: string }
  try {
    presignResult = await presignPut(key, resolvedMimeType, 600)
  } catch (err: unknown) {
    console.error("[presign] R2 presignPut failed:", err instanceof Error ? err.message : err)
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
      file_type: resolvedMimeType,
      size_bytes: sizeBytes,
      tags: tagList,
      ...(expiresAt ? { expires_at: new Date(expiresAt).toISOString() } : {}),
    })
    .select("id")
    .single()

  if (error || !data) {
    console.error("[presign] DB insert failed:", error?.message)
    return NextResponse.json({ error: "Could not save material record." }, { status: 500 })
  }

  // Set archive_status separately — insert must succeed even before migration
  void supabase
    .from("materials")
    .update({ archive_status: "pending" } as any)
    .eq("id", data.id)
    .then(() => {}, () => {})

  await logActivity({
    actorId: profile.id,
    teamId,
    action: "material.presign_issued",
    entityType: "material",
    entityId: data.id,
    metadata: {
      mime: resolvedMimeType,
      size: sizeBytes,
      archive: ARCHIVE_MIMES.has(resolvedMimeType),
    },
  })

  return NextResponse.json({
    uploadUrl: presignResult.uploadUrl,
    publicUrl: presignResult.publicUrl,
    materialId: data.id,
    key,
  })
}
