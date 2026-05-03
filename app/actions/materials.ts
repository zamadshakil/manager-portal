"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { put, del } from "@/lib/r2"
import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/auth"
import { logActivity } from "@/lib/activity"
import { ACCEPTED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from "@/lib/types"
import { indexDocument, deleteIndexed, joinContent } from "@/lib/smart-ai/indexer"

const MetaSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2_000).optional().or(z.literal("")),
  tags: z.string().trim().max(500).optional().or(z.literal("")),
  target: z.string(),
})

export async function createMaterial(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const profile = await requireRole(["main_admin", "manager"])
  if (!profile.team_id && profile.role !== "main_admin") {
    return { ok: false, error: "No team assigned." }
  }

  const file = formData.get("file") as File | null
  if (!file || file.size === 0) return { ok: false, error: "Choose a file." }
  if (file.size > MAX_FILE_SIZE_BYTES) return { ok: false, error: "File exceeds 25 MB." }
  if (!ACCEPTED_MIME_TYPES.includes(file.type as (typeof ACCEPTED_MIME_TYPES)[number])) {
    return { ok: false, error: `Unsupported file type: ${file.type}` }
  }

  const parsed = MetaSchema.safeParse({
    title: formData.get("title") || "",
    description: formData.get("description") ?? "",
    tags: formData.get("tags") ?? "",
    target: formData.get("target") || "global",
  })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }

  let teamId: string | null = null
  if (parsed.data.target === "global") {
    if (profile.role !== "main_admin") {
      return { ok: false, error: "Only Main Admin can post global materials." }
    }
    teamId = null
  } else {
    // If manager, enforce their own team_id
    if (profile.role === "manager" && parsed.data.target !== profile.team_id) {
      return { ok: false, error: "Managers can only post to their own team." }
    }
    teamId = parsed.data.target
  }

  // Random suffix keeps the public URL unguessable; the download proxy
  // (`/api/download/[id]?type=material`) re-checks RLS before streaming bytes.
  const safeName = file.name.replace(/[^\w.\-]+/g, "_")
  const pathname = `materials/${teamId ?? "global"}/${safeName}`
  const blob = await put(pathname, file, {
    access: "private",
    addRandomSuffix: true,
    contentType: file.type,
  })

  const supabase = await createClient()
  const tags = (parsed.data.tags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12)

  const { data, error } = await supabase
    .from("materials")
    .insert({
      author_id: profile.id,
      team_id: teamId,
      title: parsed.data.title,
      description: parsed.data.description || null,
      blob_url: blob.url,
      blob_pathname: blob.pathname,
      file_type: file.type,
      size_bytes: file.size,
      tags,
    })
    .select("id")
    .single()
  if (error || !data) {
    try {
      await del(blob.url)
    } catch {}
    return { ok: false, error: error?.message ?? "Could not save material." }
  }

  await logActivity({
    actorId: profile.id,
    teamId: teamId,
    action: "material.created",
    entityType: "material",
    entityId: data.id,
    metadata: { mime: file.type, size: file.size, tags },
  })

  // Index title + description + tags. The file itself is *not* yet parsed
  // into the RAG index — that's the next step (server-side text extraction
  // for PDFs / DOCX / images). Even the metadata-only index already lets
  // Smart AI answer "what materials cover X?" by tag.
  void indexDocument({
    source_type: "material",
    source_id: data.id,
    team_id: teamId,
    owner_id: profile.id,
    title: parsed.data.title,
    content: joinContent([
      parsed.data.title,
      parsed.data.description ?? null,
      tags.length ? `Tags: ${tags.join(", ")}` : null,
    ]),
    metadata: { tags, mime: file.type },
  })

  revalidatePath("/dashboard/materials")
  return { ok: true }
}

export async function deleteMaterial(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const profile = await requireRole(["main_admin", "manager"])
  const id = String(formData.get("id") || "")
  const supabase = await createClient()
  const { data: row } = await supabase
    .from("materials")
    .select("id, team_id, blob_url")
    .eq("id", id)
    .single()
  if (!row) return { ok: false, error: "Not found" }

  // Managers can only delete materials from their own team.
  if (profile.role === "manager" && row.team_id !== profile.team_id) {
    return { ok: false, error: "Not authorized to delete this material." }
  }

  const { error } = await supabase.from("materials").delete().eq("id", id)
  if (error) return { ok: false, error: error.message }

  try {
    if (row.blob_url) await del(row.blob_url)
  } catch (err) {
    console.error("[materials] blob delete failed", err)
  }

  await logActivity({
    actorId: profile.id,
    teamId: row.team_id,
    action: "material.deleted",
    entityType: "material",
    entityId: id,
  })

  void deleteIndexed({ source_type: "material", source_id: id })

  revalidatePath("/dashboard/materials")
  return { ok: true }
}
