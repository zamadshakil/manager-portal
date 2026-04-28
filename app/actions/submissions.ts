"use server"

import { after } from "next/server"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { put, del } from "@vercel/blob"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireProfile } from "@/lib/auth"
import { logActivity } from "@/lib/activity"
import { uploadLimiter } from "@/lib/redis"
import { processSubmission } from "@/lib/llm/pipeline"
import { ACCEPTED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from "@/lib/types"

const UploadSchema = z.object({
  title: z.string().trim().min(2, "Title must be at least 2 characters").max(200),
})

export interface ActionResult {
  ok: boolean
  error?: string
  submissionId?: string
}

export async function createSubmission(formData: FormData): Promise<ActionResult> {
  const profile = await requireProfile()
  if (!profile.team_id) return { ok: false, error: "You are not assigned to a team." }

  const file = formData.get("file") as File | null
  if (!file || file.size === 0) return { ok: false, error: "Choose a file to upload." }
  if (file.size > MAX_FILE_SIZE_BYTES) return { ok: false, error: "File exceeds 25 MB limit." }
  if (!ACCEPTED_MIME_TYPES.includes(file.type as (typeof ACCEPTED_MIME_TYPES)[number])) {
    return { ok: false, error: `Unsupported file type: ${file.type || "unknown"}` }
  }

  const parsed = UploadSchema.safeParse({ title: formData.get("title") })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }

  // Per-user rate limit on uploads.
  const limit = await uploadLimiter().limit(`user:${profile.id}`)
  if (!limit.success) {
    return { ok: false, error: "Too many uploads. Please wait a moment and try again." }
  }

  // Upload to Vercel Blob (private, server-side put with Pages Router-style multipart).
  const safeName = file.name.replace(/[^\w.\-]+/g, "_")
  const pathname = `submissions/${profile.team_id}/${profile.id}/${Date.now()}-${safeName}`
  const blob = await put(pathname, file, {
    access: "public", // public-by-URL but unlisted; signed access can be added later.
    addRandomSuffix: false,
    contentType: file.type,
  })

  // Insert submission row (RLS allows this for the uploader).
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("submissions")
    .insert({
      uploader_id: profile.id,
      team_id: profile.team_id,
      title: parsed.data.title,
      blob_url: blob.url,
      blob_pathname: pathname,
      mime_type: file.type,
      size_bytes: file.size,
      status: "queued",
    })
    .select("id")
    .single()

  if (error || !data) {
    // Roll back the blob if DB insert fails.
    try {
      await del(blob.url)
    } catch {}
    return { ok: false, error: error?.message ?? "Could not save submission." }
  }

  await logActivity({
    actorId: profile.id,
    teamId: profile.team_id,
    action: "submission.created",
    entityType: "submission",
    entityId: data.id,
    metadata: { title: parsed.data.title, size: file.size, mime: file.type },
  })

  // Run the parsing + LLM validation pipeline AFTER the response is sent.
  after(async () => {
    try {
      await processSubmission(data.id)
    } catch (err) {
      console.error("[submissions] pipeline error", err)
    }
  })

  revalidatePath("/dashboard")
  revalidatePath("/dashboard/submissions")
  return { ok: true, submissionId: data.id }
}

const RetrySchema = z.object({ id: z.string().uuid() })

export async function retrySubmission(formData: FormData): Promise<ActionResult> {
  const profile = await requireProfile()
  const parsed = RetrySchema.safeParse({ id: formData.get("id") })
  if (!parsed.success) return { ok: false, error: "Invalid submission id" }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("submissions")
    .select("id, team_id, uploader_id, status")
    .eq("id", parsed.data.id)
    .single()
  if (error || !data) return { ok: false, error: "Submission not found." }

  // Only managers, admins, or the original uploader (on failed/needs_review) may retry.
  const canRetry =
    profile.role === "main_admin" ||
    (profile.role === "manager" && profile.team_id === data.team_id) ||
    profile.id === data.uploader_id
  if (!canRetry) return { ok: false, error: "Not authorized." }

  const admin = createAdminClient()
  await admin
    .from("submissions")
    .update({ status: "queued", flags: [], score: null, summary: null })
    .eq("id", parsed.data.id)

  await logActivity({
    actorId: profile.id,
    teamId: data.team_id,
    action: "submission.retried",
    entityType: "submission",
    entityId: data.id,
  })

  after(async () => {
    try {
      await processSubmission(data.id)
    } catch (err) {
      console.error("[submissions] retry pipeline error", err)
    }
  })

  revalidatePath("/dashboard/submissions")
  revalidatePath(`/dashboard/submissions/${data.id}`)
  return { ok: true, submissionId: data.id }
}

const DeleteSchema = z.object({ id: z.string().uuid() })

export async function deleteSubmission(formData: FormData): Promise<ActionResult> {
  const profile = await requireProfile()
  const parsed = DeleteSchema.safeParse({ id: formData.get("id") })
  if (!parsed.success) return { ok: false, error: "Invalid submission id" }

  const supabase = await createClient()
  const { data: sub } = await supabase
    .from("submissions")
    .select("id, team_id, blob_url")
    .eq("id", parsed.data.id)
    .single()
  if (!sub) return { ok: false, error: "Submission not found." }

  if (
    profile.role !== "main_admin" &&
    !(profile.role === "manager" && profile.team_id === sub.team_id)
  ) {
    return { ok: false, error: "Only managers can delete submissions." }
  }

  const { error } = await supabase.from("submissions").delete().eq("id", sub.id)
  if (error) return { ok: false, error: error.message }

  try {
    if (sub.blob_url) await del(sub.blob_url)
  } catch (err) {
    console.error("[submissions] blob delete failed", err)
  }

  await logActivity({
    actorId: profile.id,
    teamId: sub.team_id,
    action: "submission.deleted",
    entityType: "submission",
    entityId: sub.id,
  })

  revalidatePath("/dashboard/submissions")
  return { ok: true }
}
