import "server-only"
import { after } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { extractText } from "@/lib/parse"
import { runRule, summarize, describeImage, PROMPT_VERSION, type RunRuleOutput } from "@/lib/llm/validate"
import { llmLimiter, getRedis } from "@/lib/redis"
import { publishStage, isQStashConfigured } from "@/lib/qstash"
import type { Submission, SubmissionFlag, ValidationRule, Task } from "@/lib/types"

// ── Tunables ────────────────────────────────────────────────────────────────

/** Concurrent rules per batch. With Gemini Flash-Lite we comfortably handle
 *  8 simultaneous calls; a paid tier can go higher. Override via env. */
const RULE_CONCURRENCY = Number(process.env.LLM_RULE_CONCURRENCY ?? 8)

/** Rules per QStash-chained batch. With concurrency=8 and ~10s per call,
 *  one batch of 8 completes in a single round and ~15s wall-clock — well
 *  inside the 60s Hobby ceiling with budget for state I/O and enqueue. */
const RULES_BATCH_SIZE = Number(process.env.LLM_RULES_BATCH_SIZE ?? 8)

/** Per-stage soft deadline. Each stage runs in its OWN function invocation
 *  with its own 60s budget — so this is for a single stage, not the whole
 *  pipeline. We leave a buffer to write the final state. */
const STAGE_BUDGET_MS = Number(process.env.PIPELINE_STAGE_BUDGET_MS ?? 50_000)

/** Preview length stored in `submissions.extracted_text`. The full text is
 *  kept in Redis state during the pipeline run; this column is for manager
 *  debugging in the dashboard. */
const EXTRACTED_TEXT_PREVIEW_CHARS = 2_000

/** TTL for the Redis pipeline-state object. Generous so a temporarily-stuck
 *  submission can resume up to 1h later, but bounded so abandoned state
 *  doesn't accumulate. */
const STATE_TTL_SECONDS = 60 * 60

// ── Pipeline state (Redis-backed across stage chain) ────────────────────────

interface PipelineState {
  text: string
  truncated: boolean
  task: Task | null
  rules: ValidationRule[]
  results: RunRuleOutput[]
  skipped: number
  startedAt: number
  /** Submission timing telemetry, accumulated across stages. */
  timing: Record<string, unknown>
}

function stateKey(id: string) {
  return `pipeline:state:${id}`
}

async function saveState(id: string, state: PipelineState): Promise<void> {
  const redis = getRedis()
  await redis.set(stateKey(id), JSON.stringify(state), { ex: STATE_TTL_SECONDS })
}

async function loadState(id: string): Promise<PipelineState | null> {
  const redis = getRedis()
  const raw = await redis.get<string | PipelineState>(stateKey(id))
  if (!raw) return null
  // Upstash auto-deserializes JSON in some clients, leaves string in others.
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as PipelineState
    } catch {
      return null
    }
  }
  return raw as PipelineState
}

async function clearState(id: string): Promise<void> {
  try {
    const redis = getRedis()
    await redis.del(stateKey(id))
  } catch {
    /* TTL will clean up */
  }
}

/** Exported so retry/delete actions can clear stale state alongside the lock. */
export async function clearPipelineLock(submissionId: string): Promise<void> {
  try {
    const redis = getRedis()
    await Promise.all([
      redis.del(`pipeline:lock:${submissionId}`),
      redis.del(stateKey(submissionId)),
    ])
  } catch {
    /* Redis unavailable — entries will expire via TTL */
  }
}

// ── Inline concurrency limiter (avoids p-limit ESM issues) ──────────────────

function pLimit(concurrency: number) {
  let active = 0
  const queue: (() => void)[] = []
  function next() {
    if (queue.length > 0 && active < concurrency) {
      active++
      queue.shift()!()
    }
  }
  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () =>
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--
            next()
          })
      queue.push(run)
      next()
    })
}

// ── Stage transition helper ─────────────────────────────────────────────────

/**
 * Transition to the next stage. In production with QStash configured, this
 * publishes a message and returns immediately — the next stage runs in a
 * fresh function invocation with a fresh 60s budget. Without QStash (local
 * dev or emergency fallback), we run the next stage inline in the same
 * process via `after()` to keep the pipeline functional but bounded by the
 * current function's budget.
 */
async function transitionTo(submissionId: string, stage: string): Promise<void> {
  if (isQStashConfigured()) {
    await publishStage({ submissionId, stage })
    return
  }
  // Fallback: same-process execution. Will share the current function budget.
  console.warn(
    "[pipeline] QStash not configured — running",
    stage,
    "inline. Configure QSTASH_TOKEN for production-grade staged execution.",
  )
  after(async () => {
    try {
      await runStage(submissionId, stage)
    } catch (err) {
      console.error("[pipeline] inline stage failed", stage, err)
    }
  })
}

// ── Public entry: kick off a pipeline run ───────────────────────────────────

/**
 * Enqueue the pipeline for a submission. Replaces the old
 * `processSubmission` entry. Idempotent via QStash deduplicationId.
 *
 * - Acquires a Redis lock so a duplicate enqueue doesn't double-run.
 * - Publishes the "parse" stage to QStash (or runs inline if not configured).
 */
export async function enqueueSubmission(submissionId: string): Promise<void> {
  const redis = (() => {
    try {
      return getRedis()
    } catch {
      return null
    }
  })()

  if (redis) {
    const acquired = await redis.set(`pipeline:lock:${submissionId}`, "1", {
      nx: true,
      ex: 600,
    })
    if (!acquired) {
      console.warn("[pipeline] another worker holds the lock for", submissionId)
      return
    }
  }

  await transitionTo(submissionId, "parse")
}

/**
 * Backwards-compat shim. Some callers (cron, manual scripts) may still
 * import this name. Routes the call through the new staged enqueue path.
 */
export async function processSubmission(submissionId: string): Promise<void> {
  await enqueueSubmission(submissionId)
}

// ── Stage dispatcher (called by the QStash webhook) ─────────────────────────

export async function runStage(submissionId: string, stage: string): Promise<void> {
  // Catch-all so a stage error always writes a terminal state.
  try {
    if (stage === "parse") {
      await stageParse(submissionId)
    } else if (stage.startsWith("rules:")) {
      const idx = Number(stage.slice("rules:".length))
      if (Number.isNaN(idx)) throw new Error(`Invalid rules stage: ${stage}`)
      await stageRules(submissionId, idx)
    } else if (stage === "finalize") {
      await stageFinalize(submissionId)
    } else {
      throw new Error(`Unknown stage: ${stage}`)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[pipeline] stage", stage, "crashed for", submissionId, msg, err)
    await markFailedSafe(submissionId, `${stage} stage crashed: ${msg.slice(0, 200)}`)
    await clearState(submissionId)
    await clearLock(submissionId)
  }
}

async function clearLock(id: string) {
  try {
    const redis = getRedis()
    await redis.del(`pipeline:lock:${id}`)
  } catch {
    /* noop */
  }
}

async function markFailedSafe(submissionId: string, reason: string) {
  try {
    const admin = createAdminClient()
    await admin
      .from("submissions")
      .update({
        status: "failed",
        flags: [{ severity: "fail" as const, message: reason }] satisfies SubmissionFlag[],
      })
      .eq("id", submissionId)
  } catch (writeErr) {
    console.error("[pipeline] failed to write final status", writeErr)
  }
}

// ── Stage 1: Parse ──────────────────────────────────────────────────────────

async function stageParse(submissionId: string): Promise<void> {
  const admin = createAdminClient()
  const startedAt = Date.now()

  const { data: subData, error: subError } = await admin
    .from("submissions")
    .select("*")
    .eq("id", submissionId)
    .single()
  if (subError || !subData) {
    console.error("[pipeline] submission not found", submissionId, subError)
    await clearLock(submissionId)
    return
  }
  const submission = subData as Submission

  // Skip if already terminal (a duplicate QStash delivery).
  if (
    ["passed", "failed", "needs_review", "late_submitted", "missed"].includes(
      submission.status,
    )
  ) {
    console.log("[pipeline] submission already terminal, skipping", submissionId, submission.status)
    return
  }

  await admin.from("submissions").update({ status: "parsing" }).eq("id", submissionId)

  // Per-stage abort/budget signal so a slow LLM doesn't blow the budget.
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), STAGE_BUDGET_MS)
  const remaining = () => STAGE_BUDGET_MS - (Date.now() - startedAt)

  let text = ""
  let truncated = false

  try {
    const { get: getBlob } = await import("@vercel/blob")
    console.log("[pipeline:parse]", submissionId, "mime:", submission.mime_type)

    const blobResult = await getBlob(submission.blob_url, {
      access: "private" as const,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    })
    if (!blobResult || !blobResult.stream) {
      throw new Error(`blob stream is missing for: ${submission.blob_url}`)
    }
    const chunks: Uint8Array[] = []
    const reader = blobResult.stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    const buf = Buffer.concat(chunks)
    console.log("[pipeline:parse] downloaded", buf.length, "bytes")

    const isImage = submission.mime_type.startsWith("image/")
    if (isImage) {
      try {
        const vision = await describeImage(buf, submission.mime_type, { abortSignal: ctrl.signal })
        text = vision.text || ""
        truncated = false
      } catch (visionErr) {
        const msg = visionErr instanceof Error ? visionErr.message : String(visionErr)
        console.error("[pipeline:parse] vision failed", msg)
        await admin
          .from("submissions")
          .update({
            status: "needs_review",
            flags: [
              {
                severity: "warn" as const,
                message: `Could not extract text from image (${msg.slice(0, 120)}). Marked for manual review.`,
              },
            ] satisfies SubmissionFlag[],
          })
          .eq("id", submissionId)
        await clearLock(submissionId)
        return
      }
    } else {
      const parsed = await extractText(buf, submission.mime_type)
      text = parsed.text
      truncated = parsed.truncated
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error("[pipeline:parse] error for", submissionId, errorMsg)
    await admin
      .from("submissions")
      .update({
        status: "failed",
        flags: [
          { severity: "fail" as const, message: `Parse Error: ${errorMsg.slice(0, 200)}` },
        ] satisfies SubmissionFlag[],
      })
      .eq("id", submissionId)
    await clearLock(submissionId)
    return
  } finally {
    clearTimeout(timer)
  }

  if (!text || text.trim().length < 20) {
    await admin
      .from("submissions")
      .update({
        status: "needs_review",
        flags: [
          {
            severity: "warn" as const,
            message: "Could not extract enough text from the file.",
          },
        ] satisfies SubmissionFlag[],
      })
      .eq("id", submissionId)
    await clearLock(submissionId)
    return
  }

  if (remaining() < 5_000) {
    console.warn("[pipeline:parse] budget exhausted before persist", submissionId)
    await admin
      .from("submissions")
      .update({
        status: "needs_review",
        extracted_text: text.slice(0, EXTRACTED_TEXT_PREVIEW_CHARS),
        flags: [
          {
            severity: "warn" as const,
            message: "Document parsing took too long. Please retry.",
          },
        ] satisfies SubmissionFlag[],
      })
      .eq("id", submissionId)
    await clearLock(submissionId)
    return
  }

  // Rate-limit AFTER parse so we don't waste extraction work.
  const limit = await llmLimiter().limit(`team:${submission.team_id}`)
  if (!limit.success) {
    await admin
      .from("submissions")
      .update({
        status: "needs_review",
        extracted_text: text.slice(0, EXTRACTED_TEXT_PREVIEW_CHARS),
        flags: [
          {
            severity: "warn" as const,
            message: "LLM quota reached for this team. Marked for manual review.",
          },
        ] satisfies SubmissionFlag[],
      })
      .eq("id", submissionId)
    await clearLock(submissionId)
    return
  }

  // Load rules + task in parallel.
  const [{ data: rulesData }, taskRow] = await Promise.all([
    admin
      .from("validation_rules")
      .select("*")
      .eq("team_id", submission.team_id)
      .eq("enabled", true),
    submission.task_id
      ? admin.from("tasks").select("*").eq("id", submission.task_id).maybeSingle()
      : Promise.resolve({ data: null as Task | null }),
  ])
  const rules = (rulesData ?? []) as ValidationRule[]
  const task = (taskRow?.data as Task | null) ?? null

  const filteredRules: ValidationRule[] =
    task && task.rule_ids !== null
      ? rules.filter((r) => (task.rule_ids as string[]).includes(r.id))
      : [...rules]

  if (task && task.instructions && task.instructions.trim().length > 0) {
    filteredRules.push({
      id: `task:${task.id}`,
      team_id: submission.team_id,
      rule_name: `Task brief: ${task.title}`,
      description: task.description,
      prompt_template: task.instructions,
      threshold: 70,
      weight: 2,
      enabled: true,
      created_by: task.manager_id,
      created_at: task.created_at,
      updated_at: task.updated_at,
    })
  }

  // Mark as validating + persist preview text.
  await admin
    .from("submissions")
    .update({
      status: "validating",
      extracted_text: text.slice(0, EXTRACTED_TEXT_PREVIEW_CHARS),
    })
    .eq("id", submissionId)

  // Zero-rule short-circuit — go straight to finalize so the row leaves
  // `validating` cleanly with a clear message.
  if (filteredRules.length === 0) {
    await admin
      .from("submissions")
      .update({
        status: "needs_review",
        score: null,
        summary: "",
        flags: [
          {
            severity: "info" as const,
            message:
              "No validation rules are configured for this team. Please ask your manager to set up validation rules, then retry.",
          },
        ] satisfies SubmissionFlag[],
        metadata: {
          rules_evaluated: 0,
          had_task: Boolean(task),
          truncated,
          timing: { parse_ms: Date.now() - startedAt },
          total_ms: Date.now() - startedAt,
        },
      })
      .eq("id", submissionId)
    await clearLock(submissionId)
    return
  }

  // Wipe any prior runs so retries don't double-count.
  await admin.from("validation_runs").delete().eq("submission_id", submissionId)

  // Persist state for subsequent stages.
  const state: PipelineState = {
    text,
    truncated,
    task,
    rules: filteredRules,
    results: [],
    skipped: 0,
    startedAt,
    timing: { parse_ms: Date.now() - startedAt },
  }
  await saveState(submissionId, state)

  // Hand off to the first rules batch.
  await transitionTo(submissionId, "rules:0")
}

// ── Stage 2: Rules (chained, batch by batch) ────────────────────────────────

async function stageRules(submissionId: string, batchIdx: number): Promise<void> {
  const state = await loadState(submissionId)
  if (!state) {
    console.error("[pipeline:rules] state missing for", submissionId, "batch", batchIdx)
    await markFailedSafe(submissionId, "Pipeline state was lost between stages. Please retry.")
    await clearLock(submissionId)
    return
  }

  // Skip if already terminal (defensive — duplicate delivery).
  const admin = createAdminClient()
  const { data: cur } = await admin
    .from("submissions")
    .select("status")
    .eq("id", submissionId)
    .maybeSingle()
  if (
    cur &&
    ["passed", "failed", "needs_review", "late_submitted", "missed"].includes(cur.status)
  ) {
    await clearState(submissionId)
    await clearLock(submissionId)
    return
  }

  const startedAt = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), STAGE_BUDGET_MS)
  const remaining = () => STAGE_BUDGET_MS - (Date.now() - startedAt)

  const batchStart = batchIdx * RULES_BATCH_SIZE
  const batchEnd = Math.min(batchStart + RULES_BATCH_SIZE, state.rules.length)
  const batch = state.rules.slice(batchStart, batchEnd)

  console.log(
    "[pipeline:rules]",
    submissionId,
    "batch",
    batchIdx,
    `(${batchStart}-${batchEnd}/${state.rules.length})`,
  )

  let batchResults: RunRuleOutput[] = []
  let batchSkipped = 0
  try {
    const limiter = pLimit(Math.max(1, RULE_CONCURRENCY))
    const outputs = await Promise.all(
      batch.map((rule) =>
        limiter(async () => {
          if (ctrl.signal.aborted || remaining() < 3_000) {
            return null
          }
          try {
            return await runRule(state.text, rule, {
              truncated: state.truncated,
              abortSignal: ctrl.signal,
            })
          } catch (err) {
            console.error("[pipeline:rules] rule failed", rule.rule_name, err)
            return null
          }
        }),
      ),
    )
    batchResults = outputs.filter((r): r is NonNullable<typeof r> => Boolean(r))
    batchSkipped = batch.length - batchResults.length
  } finally {
    clearTimeout(timer)
  }

  // Persist this batch's validation_runs (only real, non-synthetic rules).
  const persistable = batchResults.filter((r) => !r.rule_id.startsWith("task:"))
  if (persistable.length > 0) {
    await admin.from("validation_runs").insert(
      persistable.map((r) => ({
        submission_id: submissionId,
        rule_id: r.rule_id,
        model: r.model,
        prompt_version: PROMPT_VERSION,
        raw_output: { ...(r.raw as Record<string, unknown>), rule_name: r.rule_name },
        pass: r.pass,
        score: r.score,
        reasons: r.reasons,
        flags: r.flags,
        latency_ms: r.latency_ms,
      })),
    )
  }

  // Accumulate into state and save before transitioning.
  const next: PipelineState = {
    ...state,
    results: [...state.results, ...batchResults],
    skipped: state.skipped + batchSkipped,
    timing: {
      ...state.timing,
      [`rules_batch_${batchIdx}_ms`]: Date.now() - startedAt,
    },
  }
  await saveState(submissionId, next)

  if (batchEnd < state.rules.length) {
    await transitionTo(submissionId, `rules:${batchIdx + 1}`)
  } else {
    await transitionTo(submissionId, "finalize")
  }
}

// ── Stage 3: Finalize ───────────────────────────────────────────────────────

async function stageFinalize(submissionId: string): Promise<void> {
  const admin = createAdminClient()
  const state = await loadState(submissionId)
  if (!state) {
    console.error("[pipeline:finalize] state missing for", submissionId)
    await markFailedSafe(submissionId, "Pipeline state was lost before finalize. Please retry.")
    await clearLock(submissionId)
    return
  }

  const startedAt = Date.now()

  const { data: subData } = await admin
    .from("submissions")
    .select("*")
    .eq("id", submissionId)
    .single()
  if (!subData) {
    await clearState(submissionId)
    await clearLock(submissionId)
    return
  }
  const submission = subData as Submission

  // Skip if a duplicate delivery already finalized.
  if (
    ["passed", "failed", "needs_review", "late_submitted", "missed"].includes(submission.status)
  ) {
    await clearState(submissionId)
    await clearLock(submissionId)
    return
  }

  const successful = state.results
  const totalRules = state.rules.length

  // All rules failed → explicit failure.
  if (successful.length === 0 && totalRules > 0) {
    await admin
      .from("submissions")
      .update({
        status: "failed",
        score: null,
        summary: "",
        flags: [
          {
            severity: "fail" as const,
            message: `All ${totalRules} validation rules failed to execute. The AI service may be temporarily unavailable. Please retry later.`,
          },
        ] satisfies SubmissionFlag[],
        metadata: {
          rules_evaluated: 0,
          rules_attempted: totalRules,
          had_task: Boolean(state.task),
          truncated: state.truncated,
          timing: state.timing,
          total_ms: Date.now() - state.startedAt,
        },
      })
      .eq("id", submissionId)
    await clearState(submissionId)
    await clearLock(submissionId)
    return
  }

  // Summary (best-effort — never blocks finalisation).
  const summaryStart = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), STAGE_BUDGET_MS)
  let summary = ""
  let predictive: string[] = []
  try {
    const s = await summarize(state.text, {
      truncated: state.truncated,
      abortSignal: ctrl.signal,
    })
    summary = s.summary
    predictive = s.predictive_flags
  } catch (err) {
    console.error("[pipeline:finalize] summary failed", err)
  } finally {
    clearTimeout(timer)
  }

  const totalWeight = successful.reduce((s, r) => s + Number(r.weight || 1), 0) || 1
  const aggScore =
    successful.reduce((s, r) => s + Number(r.score) * Number(r.weight || 1), 0) / totalWeight
  const allPassed = successful.length > 0 && successful.every((r) => r.pass)
  const anyHardFail = successful.some((r) => r.flags.some((f) => f.severity === "fail"))

  const aggregateFlags: SubmissionFlag[] = [
    ...successful.flatMap((r) =>
      r.flags.map<SubmissionFlag>((f) => ({
        rule_id: r.rule_id,
        rule_name: r.rule_name,
        severity: f.severity,
        message: f.message,
      })),
    ),
    ...predictive.map<SubmissionFlag>((p) => ({
      severity: "info",
      message: `Predictive: ${p}`,
    })),
  ]

  if (state.skipped > 0) {
    aggregateFlags.unshift({
      severity: "warn",
      message: `${state.skipped} of ${totalRules} rules were skipped because the AI service did not respond. Retry to evaluate them.`,
    })
  }

  let finalStatus: Submission["status"]
  if (submission.is_late) {
    finalStatus = "late_submitted"
  } else if (state.skipped > 0 && successful.length > 0) {
    finalStatus = "needs_review"
  } else {
    finalStatus = allPassed && !anyHardFail ? "passed" : anyHardFail ? "failed" : "needs_review"
  }

  const totalMs = Date.now() - state.startedAt
  const persistable = successful.filter((r) => !r.rule_id.startsWith("task:"))

  await admin
    .from("submissions")
    .update({
      status: finalStatus,
      score: Number(aggScore.toFixed(2)),
      summary,
      flags: aggregateFlags,
      metadata: {
        rules_evaluated: persistable.length,
        rules_skipped: state.skipped,
        topics: predictive,
        truncated: state.truncated,
        had_task: Boolean(state.task),
        timing: {
          ...state.timing,
          summary_ms: Date.now() - summaryStart,
          total_ms: totalMs,
        },
      },
    })
    .eq("id", submissionId)

  // Mirror status onto task_assignment.
  if (submission.task_assignment_id) {
    await admin
      .from("task_assignments")
      .update({
        status: submission.is_late ? "late_submitted" : "submitted",
        submission_id: submissionId,
        submitted_at: submission.submitted_at ?? new Date().toISOString(),
      })
      .eq("id", submission.task_assignment_id)
  }

  await clearState(submissionId)
  await clearLock(submissionId)
}
