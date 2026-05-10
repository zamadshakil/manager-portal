"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { put, del } from "@/lib/r2"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireProfile } from "@/lib/auth"
import { AccessDeniedError, assertCapability, CAPABILITIES, hasScopedCapability } from "@/lib/permissions"
import { logActivity } from "@/lib/activity"
import { uploadLimiter } from "@/lib/redis"
import { clearPipelineLock } from "@/lib/llm/pipeline"
import { ACCEPTED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from "@/lib/types"
import { indexDocument, deleteIndexed, joinContent } from "@/lib/smart-ai/indexer"



const UploadSchema = z.object({
  title: z.string().trim().min(2, "Title must be at least 2 characters").max(200),
  taskId: z.string().uuid().optional(),
  lateReason: z.string().trim().max(1000).optional(),
})

export interface ActionResult {
  ok: boolean
  error?: string
  submissionId?: string
}

/**
 * Create a submission. Optionally tied to a task: if a `taskId` is supplied,
 * we look up the assignment row, enforce deadline rules, and persist late
 * metadata.
 *
 * The AI validation pipeline is NOT triggered here — it runs in a separate
 * API route (`/api/pipeline/[id]`) with its own 60s timeout budget. The
 * client fires the pipeline POST after receiving the submissionId.
 */
export async function createSubmission(formData: FormData): Promise<ActionResult> {
  const profile = await requireProfile()
  if (!profile.team_id) return { ok: false, error: "You are not assigned to a team." }

  const file = formData.get("file") as File | null
  if (!file || file.size === 0) return { ok: false, error: "Choose a file to upload." }
  if (file.size > MAX_FILE_SIZE_BYTES) return { ok: false, error: "File exceeds 25 MB limit." }
  // M-12: Require a non-empty, explicitly allow-listed MIME type.
  if (!file.type || !ACCEPTED_MIME_TYPES.includes(file.type as (typeof ACCEPTED_MIME_TYPES)[number])) {
    return { ok: false, error: `Unsupported or missing file type: ${file.type || "unknown"}` }
  }

  const parsed = UploadSchema.safeParse({
    title: formData.get("title") || "",
    taskId: formData.get("taskId") || undefined,
    lateReason: formData.get("lateReason") || undefined,
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  // Per-user rate limit on uploads.
  const limit = await uploadLimiter().limit(`user:${profile.id}`)
  if (!limit.success) {
    return { ok: false, error: "Too many uploads. Please wait a moment and try again." }
  }

  // ---------- Task linkage + deadline enforcement ----------
  const supabase = await createClient()
  let taskId: string | null = null
  let taskAssignmentId: string | null = null
  let isLate = false
  let lateReason: string | null = null

  if (parsed.data.taskId) {
    const { data: task } = await supabase
      .from("tasks")
      .select("id, team_id, due_at, allow_late, late_submission_deadline, require_late_reason, title")
      .eq("id", parsed.data.taskId)
      .maybeSingle()
    if (!task) return { ok: false, error: "Task not found." }
    if (task.team_id !== profile.team_id) {
      return { ok: false, error: "This task belongs to a different team." }
    }

    const { data: assignment } = await supabase
      .from("task_assignments")
      .select("id, status")
      .eq("task_id", task.id)
      .eq("assignee_id", profile.id)
      .maybeSingle()
    if (!assignment) {
      return { ok: false, error: "You are not assigned to this task." }
    }
    if (assignment.status === "submitted" || assignment.status === "late_submitted") {
      return { ok: false, error: "You have already submitted this task." }
    }
    if (assignment.status === "missed") {
      return { ok: false, error: "Submission window has closed for this task." }
    }

    const now = Date.now()
    const due = task.due_at ? new Date(task.due_at).getTime() : null
    if (due !== null && now > due) {
      if (!task.allow_late) {
        return {
          ok: false,
          error: "Submission failed: the deadline has passed and late submissions are not allowed.",
        }
      }
      if (task.allow_late && task.late_submission_deadline) {
        const lateDeadline = new Date(task.late_submission_deadline).getTime()
        if (now > lateDeadline) {
          return {
            ok: false,
            error: "Submission failed: the late submission deadline has passed.",
          }
        }
      }
      isLate = true
      const reason = parsed.data.lateReason?.trim() ?? ""
      if (task.require_late_reason && reason.length < 8) {
        return {
          ok: false,
          error: "Late submission requires a reason (at least 8 characters).",
        }
      }
      lateReason = reason || null
    }

    taskId = task.id
    taskAssignmentId = assignment.id
  }

  // ---------- Upload to R2 ----------
  // We add a random suffix so the URL is unguessable; the client never receives
  // `blob_url` directly — they hit `/api/download/[id]` which re-checks RLS.
  const safeName = file.name.replace(/[^\w.\-]+/g, "_")
  const pathname = `submissions/${profile.team_id}/${profile.id}/${safeName}`
  const blob = await put(pathname, file, {
    access: "private",
    addRandomSuffix: true,
    contentType: file.type,
  })

  // ---------- Insert submission row ----------
  const adminClient = createAdminClient()
  const { data, error } = await adminClient
    .from("submissions")
    .insert({
      uploader_id: profile.id,
      team_id: profile.team_id,
      title: parsed.data.title,
      blob_url: blob.url,
      blob_pathname: blob.pathname,
      mime_type: file.type,
      size_bytes: file.size,
      status: "queued",
      task_id: taskId,
      task_assignment_id: taskAssignmentId,
      is_late: isLate,
      late_reason: lateReason,
      submitted_at: new Date().toISOString(),
    })
    .select("id")
    .single()

  if (error || !data) {
    try {
      await del(blob.url)
    } catch {}
    return { ok: false, error: error?.message ?? "Could not save submission." }
  }

  // Mirror initial state onto the assignment immediately so manager dashboards
  // reflect the submission within their next refresh — the pipeline will
  // overwrite this with the final status when it finishes.
  //
  // We deliberately use the service-role client here. RLS on
  // task_assignments no longer permits members to write the row directly
  // (that was a self-mark-submitted vector — see migration 006). The action
  // has already verified ownership and deadline above, so a service-role
  // write is safe and authoritative.
  if (taskAssignmentId) {
    await adminClient
      .from("task_assignments")
      .update({
        status: isLate ? "late_submitted" : "submitted",
        submission_id: data.id,
        late_reason: lateReason,
        submitted_at: new Date().toISOString(),
      })
      .eq("id", taskAssignmentId)
      .eq("assignee_id", profile.id)
  }

  await logActivity({
    actorId: profile.id,
    teamId: profile.team_id,
    action: "submission.created",
    entityType: "submission",
    entityId: data.id,
    metadata: {
      title: parsed.data.title,
      size: file.size,
      mime: file.type,
      task_id: taskId,
      late: isLate,
    },
  })

  revalidatePath("/dashboard")
  revalidatePath("/dashboard/submissions")
  if (taskId) {
    revalidatePath("/dashboard/tasks")
    revalidatePath(`/dashboard/tasks/${taskId}`)
  }

  // Push a stub into the RAG index. The submission's extracted text /
  // validation summary aren't ready yet — those land asynchronously when
  // /api/pipeline/[id] finishes. The pipeline route re-indexes with the
  // richer content. Even this stub is useful so Smart AI can answer
  // "what did <member> just upload?" right away.
  void indexDocument({
    source_type: "submission",
    source_id: data.id,
    team_id: profile.team_id,
    owner_id: profile.id,
    title: parsed.data.title,
    content: joinContent([
      parsed.data.title,
      `Uploaded by ${profile.id} on team ${profile.team_id}.`,
      taskId ? `Linked to task ${taskId}.` : null,
      isLate ? `Late submission. Reason: ${lateReason ?? "(none)"}` : null,
    ]),
    metadata: {
      task_id: taskId,
      is_late: isLate,
      mime: file.type,
    },
  })

  // Return the submissionId so the client can trigger the pipeline via
  // POST /api/pipeline/[id] and poll for status updates.
  return { ok: true, submissionId: data.id }
}

const RetrySchema = z.object({ id: z.string().uuid() })

export async function retrySubmission(formData: FormData): Promise<ActionResult> {
  const profile = await requireProfile()
  const parsed = RetrySchema.safeParse({ id: formData.get("id") })
  if (!parsed.success) return { ok: false, error: "Invalid submission id" }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("submissions")
    .select("id, team_id, uploader_id, status, metadata, blob_url")
    .eq("id", parsed.data.id)
    .single()
  if (error || !data) return { ok: false, error: "Submission not found." }

  // Pre-flight check: verify the file still exists in R2 before
  // queueing a retry. If the blob was deleted, the pipeline will always fail.
  if (data.blob_url) {
    try {
      const { head } = await import("@/lib/r2")
      await head(data.blob_url)
    } catch {
      return { ok: false, error: "The original file no longer exists. Please upload a new submission instead." }
    }
  }

  // Only managers, admins, or the original uploader (on system failure) may retry.
  // A system failure is when it failed but the AI didn't successfully evaluate any rules.
  const isSystemFailure =
    (data.status === "failed" || data.status === "needs_review") &&
    !((data.metadata as any)?.rules_evaluated > 0)

  const canRetry =
    await hasScopedCapability(profile, CAPABILITIES.SUBMISSIONS_UPDATE, {
      team_id: data.team_id,
      owner_id: data.uploader_id,
    }) ||
    (profile.id === data.uploader_id && isSystemFailure)
  if (!canRetry) return { ok: false, error: "Not authorized." }

  await admin
    .from("submissions")
    .update({ status: "queued", flags: [], score: null, summary: null })
    .eq("id", parsed.data.id)

  // Clear any stale pipeline lock so the retry isn't silently blocked.
  await clearPipelineLock(parsed.data.id)

  await logActivity({
    actorId: profile.id,
    teamId: data.team_id,
    action: "submission.retried",
    entityType: "submission",
    entityId: data.id,
  })

  revalidatePath("/dashboard/submissions")
  revalidatePath(`/dashboard/submissions/${data.id}`)

  // Return submissionId so the client can trigger the pipeline via
  // POST /api/pipeline/[id] independently.
  return { ok: true, submissionId: data.id }
}

const DeleteSchema = z.object({ id: z.string().uuid() })

export async function deleteSubmission(formData: FormData): Promise<ActionResult> {
  const profile = await requireProfile()
  const parsed = DeleteSchema.safeParse({ id: formData.get("id") })
  if (!parsed.success) return { ok: false, error: "Invalid submission id" }

  const admin = createAdminClient()
  const { data: sub } = await admin
    .from("submissions")
    .select("id, team_id, blob_url")
    .eq("id", parsed.data.id)
    .single()
  if (!sub) return { ok: false, error: "Submission not found." }

  try {
    await assertCapability(profile, CAPABILITIES.SUBMISSIONS_DELETE, {
      team_id: sub.team_id,
      is_global: false,
    })
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      return { ok: false, error: "You do not have permission to delete this submission." }
    }
    throw err
  }

  const { error } = await admin.from("submissions").delete().eq("id", sub.id)
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

  void deleteIndexed({ source_type: "submission", source_id: sub.id })

  revalidatePath("/dashboard/submissions")
  return { ok: true }
}

const BulkDeleteSchema = z.object({ ids: z.array(z.string().uuid()) })

export async function bulkDeleteSubmissions(formData: FormData): Promise<ActionResult> {
  const profile = await requireProfile()
  // Since we can't easily pass arrays via simple FormData append without parsing tricks,
  // we assume the client stringifies the array and passes it under 'ids_json'.
  const idsJson = formData.get("ids_json") as string
  if (!idsJson) return { ok: false, error: "No ids provided" }
  
  let parsedIds: string[]
  try {
    parsedIds = JSON.parse(idsJson)
  } catch (e) {
    return { ok: false, error: "Invalid ids format" }
  }

  const parsed = BulkDeleteSchema.safeParse({ ids: parsedIds })
  if (!parsed.success) return { ok: false, error: "Invalid submission ids" }

  const admin = createAdminClient()
  
  // Verify permissions and get blob_urls
  const { data: subs, error: fetchErr } = await admin
    .from("submissions")
    .select("id, team_id, blob_url")
    .in("id", parsed.data.ids)

  if (fetchErr || !subs || subs.length === 0) {
    return { ok: false, error: "Submissions not found or fetch error." }
  }

  const allowedIds: string[] = []
  const blobUrls: string[] = []

  for (const sub of subs) {
    const canDelete = await hasScopedCapability(profile, CAPABILITIES.SUBMISSIONS_DELETE, {
      team_id: sub.team_id,
      is_global: false,
    })

    if (canDelete) {
      allowedIds.push(sub.id)
      if (sub.blob_url) blobUrls.push(sub.blob_url)
    }
  }

  if (allowedIds.length === 0) {
    return { ok: false, error: "Not authorized to delete these submissions." }
  }

  const { error } = await admin.from("submissions").delete().in("id", allowedIds)
  if (error) return { ok: false, error: error.message }

  // Delete blobs in parallel if possible, catch individually
  await Promise.allSettled(
    blobUrls.map((url) => del(url).catch((err) => console.error("[submissions] blob delete failed", err)))
  )

  await logActivity({
    actorId: profile.id,
    teamId: profile.team_id,
    action: "submission.bulk_deleted",
    entityType: "submission",
    entityId: allowedIds[0], // log against the first one
    metadata: { count: allowedIds.length },
  })

  // Strip every deleted row from the RAG index in parallel — best-effort.
  void Promise.all(
    allowedIds.map((id) => deleteIndexed({ source_type: "submission", source_id: id })),
  )

  revalidatePath("/dashboard/submissions")
  return { ok: true }
}
