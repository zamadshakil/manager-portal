"use server"

import { after } from "next/server"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { putRaw, del, presignPut, head } from "@/lib/r2"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireProfile } from "@/lib/auth"
import { AccessDeniedError, assertCapability, CAPABILITIES, hasScopedCapability } from "@/lib/permissions"
import { logActivity } from "@/lib/activity"
import { uploadLimiter, acquireUploadLock, releaseUploadLock } from "@/lib/redis"
import { clearPipelineLock, processSubmission } from "@/lib/llm/pipeline"
import { ACCEPTED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from "@/lib/types"
import { verifyMimeAgainstBuffer } from "@/lib/mime-sniff"
import { verifyFileIntegrity } from "@/lib/file-integrity"
import { indexDocument, deleteIndexed, joinContent } from "@/lib/smart-ai/indexer"
import { getTaskDeadlineWindow } from "@/lib/task-deadlines"



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
 * The AI validation pipeline is triggered server-side via `after()` once the
 * row is durably inserted. The client may also fire `POST /api/pipeline/[id]`
 * as a redundant fast-start signal — the Redis SETNX lock in
 * `processSubmission` makes that path idempotent and harmless if the
 * server-side trigger already won the race.
 *
 * Why server-side: a client-only trigger leaves the submission stuck in
 * `queued` whenever the browser closes, navigates, hits a rate limit, or
 * loses network between the action returning and the POST landing. The
 * `after()` invocation runs inside this request's Railway process and
 * survives the response being sent.
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

  // Magic-byte sniff so a renamed `.exe` (or any other spoofed payload) never
  // reaches R2 or the parser. We read the buffer once here and reuse it for
  // the upload below so we don't pay the I/O cost twice for legitimate files.
  let fileBuffer: Buffer
  try {
    fileBuffer = Buffer.from(await file.arrayBuffer())
  } catch {
    return { ok: false, error: "Failed to read the uploaded file. Please try again." }
  }
  const mimeCheck = verifyMimeAgainstBuffer(fileBuffer, file.type)
  if (!mimeCheck.ok) {
    return { ok: false, error: mimeCheck.reason }
  }

  // Structural integrity: catch legitimately-typed but corrupted/truncated
  // files (e.g. a DOCX missing its central directory, a PDF without %%EOF)
  // before they enter the pipeline. The pipeline would surface a confusing
  // parse error 30-60s later; failing fast here lets the user fix it now.
  const integrityCheck = verifyFileIntegrity(fileBuffer, file.type)
  if (!integrityCheck.ok) {
    return { ok: false, error: integrityCheck.reason }
  }

  // Dedup mutex: reject a duplicate in-flight upload for the exact same bytes
  // from the same user (e.g. accidental double-click or network retry that
  // succeeded on the first attempt). Key = SHA-256 of userId:fileBytes, so
  // two different users uploading the same PDF share nothing.
  const { createHash } = await import("crypto")
  const fileHash = createHash("sha256").update(fileBuffer).digest("hex").slice(0, 16)
  const dedupKey = `${profile.id}:${fileHash}`
  const lockAcquired = await acquireUploadLock(dedupKey)
  if (!lockAcquired) {
    return {
      ok: false,
      error:
        "A duplicate upload of this file is already being processed. Wait a moment, then check your submissions list.",
    }
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
  const supabase = createAdminClient()
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

    const deadline = getTaskDeadlineWindow({
      dueAt: task.due_at,
      allowLate: task.allow_late,
      lateSubmissionDeadline: task.late_submission_deadline,
    })
    if (deadline.isClosed) {
      await supabase
        .from("task_assignments")
        .update({ status: "missed" })
        .eq("id", assignment.id)
        .eq("assignee_id", profile.id)
        .eq("status", "assigned")
        .is("submission_id", null)

      return {
        ok: false,
        error:
          deadline.closureReason === "late_submission_deadline"
            ? "Submission failed: the late submission deadline has passed."
            : "Submission failed: the deadline has passed and late submissions are not allowed.",
      }
    }
    if (deadline.isLateWindowOpen) {
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
  // We use `putRaw` with the buffer we already read above; calling
  // `file.arrayBuffer()` twice on a server-action File can yield 0 bytes
  // because the underlying stream is consumed on first read.
  const safeName = file.name.replace(/[^\w.\-]+/g, "_")
  const dotIdx = safeName.lastIndexOf(".")
  const base = dotIdx > 0 ? safeName.slice(0, dotIdx) : safeName
  const ext = dotIdx > 0 ? safeName.slice(dotIdx + 1) : ""
  const suffix = Math.random().toString(36).slice(2, 8)
  const finalName = ext ? `${base}-${suffix}.${ext}` : `${base}-${suffix}`
  const pathname = `submissions/${profile.team_id}/${profile.id}/${finalName}`
  let blob: { url: string; pathname: string }
  try {
    blob = await putRaw(pathname, fileBuffer, file.type)
  } catch (uploadErr: any) {
    await releaseUploadLock(dedupKey)
    console.error("[createSubmission] R2 upload failed", uploadErr)
    return {
      ok: false,
      error: `File upload failed: ${uploadErr?.message ?? "storage error"}. Please try again or contact your administrator.`,
    }
  }

  // ---------- Insert submission row ----------
  const adminClient = supabase
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
    try { await del(blob.url) } catch {}
    // Release the lock so the user can retry immediately after a DB failure.
    await releaseUploadLock(dedupKey)
    return { ok: false, error: error?.message ?? "Could not save submission." }
  }

  // Lock acquired + DB row durably inserted: release so the user can upload
  // the same file again intentionally if they want (e.g. re-submission after
  // rejection). The 30s TTL would expire anyway but releasing explicitly keeps
  // the UX responsive.
  await releaseUploadLock(dedupKey)

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

  // ---------- Trigger the AI pipeline server-side ----------
  // Mirrors the pattern used by `retrySubmission`: scheduling via `after()`
  // guarantees the pipeline runs even if the client never POSTs to
  // `/api/pipeline/[id]`. The route's POST handler is still useful as a
  // fast-start signal for power-user UIs, but it's no longer load-bearing.
  //
  // Idempotency is handled by `processSubmission`'s Redis SETNX lock
  // (`pipeline:lock:<id>`, 10 min TTL) — a redundant trigger from the client
  // will see the lock held and exit without re-running.
  after(() => {
    processSubmission(data.id).catch((err) => {
      console.error("[createSubmission] background pipeline crash for", data.id, err)
    })
  })

  // Return the submissionId so the client can poll GET /api/pipeline/[id]
  // for status updates.
  return { ok: true, submissionId: data.id }
}

// ── Pre-signed upload flow ─────────────────────────────────────────────────
// Two-step alternative to createSubmission that avoids routing the binary file
// payload through the Next.js server (and through any Cloudflare WAF / proxy
// rules that may block binary data in Server Action POSTs):
//
//   1. Client calls requestUploadUrl → gets a signed R2 PUT URL (5 min TTL).
//   2. Client PUTs the file directly to R2's storage endpoint.
//   3. Client calls createSubmissionFromKey → server verifies the object
//      landed in R2, then creates the DB row and triggers the pipeline.

/**
 * Generate a pre-signed R2 PUT URL so the browser can upload a submission
 * file directly to object storage, bypassing the Next.js server.
 */
export async function requestUploadUrl(formData: FormData): Promise<{
  ok: boolean
  error?: string
  uploadUrl?: string
  key?: string
}> {
  const profile = await requireProfile()
  if (!profile.team_id) return { ok: false, error: "You are not assigned to a team." }

  const fileName = ((formData.get("fileName") as string | null) ?? "upload").slice(0, 200)
  const mimeType = formData.get("mimeType") as string | null
  const fileSize = Number(formData.get("fileSize") ?? 0)

  if (!mimeType || !ACCEPTED_MIME_TYPES.includes(mimeType as (typeof ACCEPTED_MIME_TYPES)[number])) {
    return { ok: false, error: `Unsupported file type: ${mimeType || "unknown"}` }
  }
  if (!fileSize || fileSize <= 0) return { ok: false, error: "Choose a file to upload." }
  if (fileSize > MAX_FILE_SIZE_BYTES) return { ok: false, error: "File exceeds 25 MB limit." }

  const limit = await uploadLimiter().limit(`user:${profile.id}`)
  if (!limit.success) return { ok: false, error: "Too many uploads. Please wait a moment and try again." }

  const safeName = fileName.replace(/[^\w.\-]+/g, "_")
  const dotIdx = safeName.lastIndexOf(".")
  const base = dotIdx > 0 ? safeName.slice(0, dotIdx) : safeName
  const ext = dotIdx > 0 ? safeName.slice(dotIdx + 1) : ""
  const suffix = Math.random().toString(36).slice(2, 8)
  const finalName = ext ? `${base}-${suffix}.${ext}` : `${base}-${suffix}`
  const key = `submissions/${profile.team_id}/${profile.id}/${finalName}`

  try {
    const { uploadUrl } = await presignPut(key, mimeType, 300)
    return { ok: true, uploadUrl, key }
  } catch (err: any) {
    console.error("[requestUploadUrl] presignPut failed", err)
    return { ok: false, error: "Could not prepare upload. Please try again." }
  }
}

const KeySubmissionSchema = z.object({
  key: z.string().min(1).max(600),
  title: z.string().trim().min(2, "Title must be at least 2 characters").max(200),
  mimeType: z.string().min(1),
  fileSize: z.coerce.number().int().positive(),
  taskId: z.string().uuid().optional(),
  lateReason: z.string().trim().max(1000).optional(),
})

/**
 * Finalise a submission whose file was already uploaded directly to R2.
 * Validates the key path, confirms the object exists, then creates the DB
 * row and triggers the AI pipeline — identical to the tail of createSubmission.
 */
export async function createSubmissionFromKey(formData: FormData): Promise<ActionResult> {
  const profile = await requireProfile()
  if (!profile.team_id) return { ok: false, error: "You are not assigned to a team." }

  const parsed = KeySubmissionSchema.safeParse({
    key: formData.get("key") ?? "",
    title: formData.get("title") ?? "",
    mimeType: formData.get("mimeType") ?? "",
    fileSize: formData.get("fileSize") ?? 0,
    taskId: formData.get("taskId") || undefined,
    lateReason: formData.get("lateReason") || undefined,
  })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }

  if (!ACCEPTED_MIME_TYPES.includes(parsed.data.mimeType as (typeof ACCEPTED_MIME_TYPES)[number])) {
    return { ok: false, error: `Unsupported file type: ${parsed.data.mimeType}` }
  }
  if (parsed.data.fileSize > MAX_FILE_SIZE_BYTES) return { ok: false, error: "File exceeds 25 MB limit." }

  // Prevent path-traversal / key hijacking: the key must live under this
  // user's own upload prefix, which requestUploadUrl always generates.
  const expectedPrefix = `submissions/${profile.team_id}/${profile.id}/`
  if (!parsed.data.key.startsWith(expectedPrefix)) {
    return { ok: false, error: "Invalid upload reference." }
  }

  const limit = await uploadLimiter().limit(`user:${profile.id}`)
  if (!limit.success) return { ok: false, error: "Too many uploads. Please wait a moment and try again." }

  const PUBLIC_URL = process.env.R2_PUBLIC_URL ?? ""
  const blobUrl = `${PUBLIC_URL}/${parsed.data.key}`

  // Confirm the file actually landed in R2 before creating the DB row.
  try {
    await head(blobUrl)
  } catch {
    return { ok: false, error: "Upload not found in storage. Please upload the file again." }
  }

  // ---------- Task linkage + deadline enforcement ----------
  const supabase = createAdminClient()
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
    if (task.team_id !== profile.team_id) return { ok: false, error: "This task belongs to a different team." }

    const { data: assignment } = await supabase
      .from("task_assignments")
      .select("id, status")
      .eq("task_id", task.id)
      .eq("assignee_id", profile.id)
      .maybeSingle()
    if (!assignment) return { ok: false, error: "You are not assigned to this task." }
    if (assignment.status === "submitted" || assignment.status === "late_submitted") {
      return { ok: false, error: "You have already submitted this task." }
    }
    if (assignment.status === "missed") {
      return { ok: false, error: "Submission window has closed for this task." }
    }

    const deadline = getTaskDeadlineWindow({
      dueAt: task.due_at,
      allowLate: task.allow_late,
      lateSubmissionDeadline: task.late_submission_deadline,
    })
    if (deadline.isClosed) {
      await supabase
        .from("task_assignments")
        .update({ status: "missed" })
        .eq("id", assignment.id)
        .eq("assignee_id", profile.id)
        .eq("status", "assigned")
        .is("submission_id", null)
      return {
        ok: false,
        error:
          deadline.closureReason === "late_submission_deadline"
            ? "Submission failed: the late submission deadline has passed."
            : "Submission failed: the deadline has passed and late submissions are not allowed.",
      }
    }
    if (deadline.isLateWindowOpen) {
      isLate = true
      const reason = parsed.data.lateReason?.trim() ?? ""
      if (task.require_late_reason && reason.length < 8) {
        return { ok: false, error: "Late submission requires a reason (at least 8 characters)." }
      }
      lateReason = reason || null
    }

    taskId = task.id
    taskAssignmentId = assignment.id
  }

  // ---------- Insert submission row ----------
  const { data, error } = await supabase
    .from("submissions")
    .insert({
      uploader_id: profile.id,
      team_id: profile.team_id,
      title: parsed.data.title,
      blob_url: blobUrl,
      blob_pathname: parsed.data.key,
      mime_type: parsed.data.mimeType,
      size_bytes: parsed.data.fileSize,
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
    try { await del(blobUrl) } catch {}
    return { ok: false, error: error?.message ?? "Could not save submission." }
  }

  if (taskAssignmentId) {
    await supabase
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
      size: parsed.data.fileSize,
      mime: parsed.data.mimeType,
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
      mime: parsed.data.mimeType,
    },
  })

  after(() => {
    processSubmission(data.id).catch((err) => {
      console.error("[createSubmissionFromKey] background pipeline crash for", data.id, err)
    })
  })

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

  // Clear validation_runs from the previous attempt so the UI never shows
  // stale rule results next to a "queued" / "failed" status. The pipeline's
  // own Stage-3 cleanup only runs after parsing succeeds, so a retry that
  // fails before parsing would otherwise leak old rows.
  await admin.from("validation_runs").delete().eq("submission_id", parsed.data.id)

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

  // Trigger the pipeline server-side so the retry isn't dependent on the
  // client posting to /api/pipeline/[id]. If the user closes the tab or has a
  // flaky connection, the retry still runs. The client can still poll GET
  // /api/pipeline/[id] for live status — we just don't rely on a client POST.
  after(() => {
    processSubmission(parsed.data.id).catch((err) => {
      console.error("[retrySubmission] background pipeline crash for", parsed.data.id, err)
    })
  })

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
