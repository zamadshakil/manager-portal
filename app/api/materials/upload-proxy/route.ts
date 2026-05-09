import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { putRaw } from "@/lib/r2"
import { processArchiveBackground } from "@/lib/archive-processor"
import { logActivity } from "@/lib/activity"
import { indexDocument, joinContent } from "@/lib/smart-ai/indexer"
import { revalidatePath } from "next/cache"
import {
  ARCHIVE_MIME_TYPES,
  MAX_MATERIAL_UPLOAD_SIZE_BYTES,
  normalizeMaterialMimeType,
} from "@/lib/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

const ARCHIVE_MIMES = new Set<string>(ARCHIVE_MIME_TYPES as readonly string[])

interface MaterialUploadRow {
  id: string
  author_id: string
  team_id: string | null
  title: string
  description: string | null
  blob_url: string
  blob_pathname: string
  file_type: string | null
  tags: string[] | null
  archive_status: "pending" | "processing" | "done" | "failed" | "na" | null
}

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
  if (buffer.length > MAX_MATERIAL_UPLOAD_SIZE_BYTES) {
    return NextResponse.json(
      { error: `File exceeds the ${Math.round(MAX_MATERIAL_UPLOAD_SIZE_BYTES / 1024 / 1024)} MB limit.` },
      { status: 413 },
    )
  }

  const supabase = await createClient()
  const { data: row, error: fetchError } = (await supabase
    .from("materials")
    .select("id, author_id, team_id, title, description, blob_url, blob_pathname, file_type, tags, archive_status")
    .eq("id", materialId)
    .single()) as { data: MaterialUploadRow | null; error: { message: string } | null }

  if (fetchError || !row) {
    return NextResponse.json({ error: "Material not found." }, { status: 404 })
  }

  if (profile.role !== "main_admin" && row.author_id !== profile.id) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 })
  }

  if (row.archive_status !== "pending") {
    return NextResponse.json({ ok: true, materialId, alreadyUploaded: true })
  }

  const resolvedMimeType =
    normalizeMaterialMimeType(row.blob_pathname, row.file_type ?? contentType ?? null) ?? row.file_type ?? contentType
  if (!resolvedMimeType) {
    return NextResponse.json({ error: "Unsupported file type." }, { status: 415 })
  }

  const isArchive = ARCHIVE_MIMES.has(resolvedMimeType)

  try {
    await putRaw(row.blob_pathname, buffer, resolvedMimeType)
  } catch (err: unknown) {
    console.error("[upload-proxy] R2 upload failed:", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Storage upload failed." }, { status: 500 })
  }

  await supabase
    .from("materials")
    .update({ file_type: resolvedMimeType, archive_status: isArchive ? "processing" : "na" } as any)
    .eq("id", materialId)

  await logActivity({
    actorId: profile.id,
    teamId: row.team_id ?? null,
    action: "material.created",
    entityType: "material",
    entityId: materialId,
    metadata: {
      mime: resolvedMimeType,
      size: buffer.length,
      archive: isArchive,
      upload_path: "upload_proxy",
    },
  })

  const tagList = Array.isArray(row.tags) ? row.tags.filter(Boolean) : []
  void indexDocument({
    source_type: "material",
    source_id: materialId,
    team_id: row.team_id ?? null,
    owner_id: row.author_id ?? profile.id,
    title: row.title,
    content: joinContent([
      row.title,
      row.description ?? null,
      tagList.length ? `Tags: ${tagList.join(", ")}` : null,
    ]),
    metadata: {
      tags: tagList,
      mime: resolvedMimeType,
      size: buffer.length,
      archive: isArchive,
    },
  }).then((result) => {
    if (!result.ok) {
      console.warn("[upload-proxy] material metadata indexing skipped:", result.reason)
    }
  })

  if (isArchive) {
    void processArchiveBackground(
      materialId,
      row.blob_url,
      resolvedMimeType,
      row.team_id ?? null,
      row.author_id ?? profile.id,
      row.title,
    )
  }

  revalidatePath("/dashboard/materials")

  return NextResponse.json({ ok: true, materialId, archive: isArchive })
}
