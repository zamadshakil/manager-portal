import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { extractText } from "@/lib/parse"
import {
  runRule,
  summarize,
  describeImage,
  isSafetyFilterError,
  PROMPT_VERSION,
} from "@/lib/llm/validate"
import { llmLimiter, getRedis } from "@/lib/redis"
import type {
  Submission,
  SubmissionFlag,
  ValidationRule,
  Task,
  ValidationOutcome,
  ReviewReason,
} from "@/lib/types"

/**
 * Max rules to evaluate concurrently per submission. Tuned for the Gemini
 * free/Flash-Lite tier — going higher trades token throughput for an
 * avalanche of 429s. Override via env if a paid tier is in use.
 */
const RULE_CONCURRENCY = Number(process.env.LLM_RULE_CONCURRENCY ?? 6)

/**
 * Max characters to persist in `submissions.extracted_text`. The full text can
 * be 60k chars; storing all of it for every submission bloats the DB. We keep
 * a generous preview for manager debugging and feed the full text only to the
 * LLM during the pipeline run.
 */
const EXTRACTED_TEXT_PREVIEW_CHARS = 2_000

/**
 * Soft pipeline deadline. Railway doesn't impose a strict function timeout,
 * but we keep a budget to prevent runaway submissions. The pipeline entry
 * point is `processSubmission()` below, called from `/api/pipeline/[id]`.
 *
 * Default 75s — leaves headroom for many-rule teams (parse + 6-way parallel
 * rules + summary + DB writes) without blowing the Railway request envelope.
 */
const PIPELINE_BUDGET_MS = Number(process.env.PIPELINE_BUDGET_MS ?? 75_000)

// ---------------------------------------------------------------------------
// Inline concurrency limiter (replaces p-limit to avoid ESM-only dep issues).
// ---------------------------------------------------------------------------
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
      const run = () => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--
            next()
          })
      }
      queue.push(run)
      next()
    })
}

/**
 * Delete the Redis idempotency lock for a submission. Exported so
 * `retrySubmission` can clear a stale lock before re-running the pipeline.
 */
export async function clearPipelineLock(submissionId: string) {
  try {
    const redis = getRedis()
    if (!redis) return
    await redis.del(`pipeline:lock:${submissionId}`)
  } catch {
    // Redis unavailable — lock will expire via TTL.
  }
}

/**
 * End-to-end async validation pipeline. Called from the `/api/pipeline/[id]`
 * route via `after()` so the user sees an instant "queued" response while we:
 *   1. fetch the file from R2 (Cloudflare)
 *   2. extract plain text via the right parser for the MIME type
 *   3. (images) use Gemini vision; OCR is NOT used as a fallback in
 *      serverless because Tesseract's WASM cold-start is too slow
 *   4. run every enabled validation_rule for the team — plus the parent
 *      task's `instructions` if this submission is for a task — in parallel
 *   5. compute a weighted score, summary, and predictive flags
 *   6. write validation_runs and update the submission row
 *
 * Idempotency: a Redis SETNX lock prevents double-runs (e.g. a duplicate
 * `after()` invocation, manual retry collisions, or cron rescues).
 *
 * Failure safety: any unhandled error in `runPipeline` is caught here and
 * the submission is forced into a terminal state ("failed") so the row
 * never lingers in "validating".
 */
export async function processSubmission(submissionId: string) {
  const redis = getRedis()

  // Idempotency lock — first writer wins for 10 minutes.
  // ioredis SET signature: SET key value EX seconds NX → returns "OK" or null.
  if (redis) {
    const acquired = await redis.set(
      `pipeline:lock:${submissionId}`,
      "1",
      "EX",
      600,
      "NX",
    )
    if (!acquired) {
      console.warn("[pipeline] another worker holds the lock for", submissionId)
      return
    }
  }

  try {
    await runPipeline(submissionId)
  } catch (err) {
    // Last-resort safety net. Any error escaping `runPipeline` would otherwise
    // leave the submission stuck in `parsing`/`validating`. We mark it failed
    // so the user can retry.
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error("[pipeline] unhandled error for", submissionId, errorMsg, err)
    try {
      const admin = createAdminClient()
      await admin
        .from("submissions")
        .update({
          status: "failed",
          flags: [
            {
              severity: "fail" as const,
              message: `Validation pipeline crashed: ${errorMsg.slice(0, 200)}. Please retry.`,
            },
          ] satisfies SubmissionFlag[],
        })
        .eq("id", submissionId)
    } catch (writeErr) {
      console.error("[pipeline] failed to write final status", writeErr)
    }
  } finally {
    if (redis) await redis.del(`pipeline:lock:${submissionId}`).catch(() => {})
  }
}

async function runPipeline(submissionId: string) {
  const admin = createAdminClient()
  const timing: Record<string, number> = {}
  const pipelineStart = Date.now()

  // Pipeline-level deadline. Wired into LLM calls via `abortSignal` so any
  // in-flight request is cancelled when we run out of time.
  const deadlineController = new AbortController()
  const deadlineTimer = setTimeout(
    () => deadlineController.abort(),
    PIPELINE_BUDGET_MS,
  )
  const abortSignal = deadlineController.signal
  const remaining = () => PIPELINE_BUDGET_MS - (Date.now() - pipelineStart)

  try {
    const { data: subData, error: subError } = await admin
      .from("submissions")
      .select("*")
      .eq("id", submissionId)
      .single()
    if (subError || !subData) {
      console.error("[pipeline] submission not found", submissionId, subError)
      return
    }
    const submission = subData as unknown as Submission

    // Credit pre-check — bail before any parse/LLM work if the uploader is over quota.
    // The period is advanced first so a stale counter doesn't block a new billing period.
    try {
      await admin.rpc("maybe_reset_period", { p_user_id: submission.uploader_id })
      const { data: creditRow } = await admin
        .from("ai_credit_limits")
        .select("is_unlimited, used_this_period, monthly_limit")
        .eq("user_id", submission.uploader_id)
        .maybeSingle()
      if (creditRow && !creditRow.is_unlimited && creditRow.used_this_period >= creditRow.monthly_limit) {
        await admin
          .from("submissions")
          .update({
            status: "failed",
            flags: [
              {
                severity: "fail" as const,
                message: "AI credit limit reached for this period. Ask your administrator to increase your limit.",
              },
            ] satisfies SubmissionFlag[],
          })
          .eq("id", submissionId)
        clearTimeout(deadlineTimer)
        return
      }
    } catch (creditErr: any) {
      // Non-fatal: if the credit check errors, let the pipeline proceed rather than
      // blocking a legitimate submission. The accounting step at the end still runs.
      console.warn("[pipeline] credit pre-check failed (non-fatal):", creditErr?.message)
    }

    // ── Stage 0: pre-flight checks (cheap, run before any parse work) ────
    // (a) Verify the blob actually exists in R2. Without this, the pipeline
    //     downloads a 404 body and the failure shows up as a confusing parse
    //     error half-way through. HEAD is a single API call and saves the
    //     full GET if the file is gone.
    try {
      const { head } = await import("@/lib/r2")
      await head(submission.blob_url)
    } catch (headErr) {
      const headMsg = headErr instanceof Error ? headErr.message : String(headErr)
      console.error("[pipeline] blob HEAD failed for", submissionId, headMsg)
      await admin
        .from("submissions")
        .update({
          status: "failed",
          flags: [
            {
              severity: "fail" as const,
              message:
                "The uploaded file is no longer available in storage. Please upload the submission again.",
            },
          ] satisfies SubmissionFlag[],
        })
        .eq("id", submissionId)
      clearTimeout(deadlineTimer)
      return
    }

    // (b) Pre-parse LLM rate-limit check. The post-parse check at Stage 2
    //     is still kept (concurrent submissions can still trip it after we
    //     pass here), but this avoids wasting parse cycles on a doc we'll
    //     refuse to validate anyway.
    const preLimit = await llmLimiter().limit(`team:${submission.team_id}`)
    if (!preLimit.success) {
      const reviewMeta: { validation_outcome: ValidationOutcome; review_reason: ReviewReason } = {
        validation_outcome: "needs_review",
        review_reason: "llm_quota",
      }
      await admin
        .from("submissions")
        .update({
          status: "needs_review",
          flags: [
            {
              severity: "warn" as const,
              message:
                "Your team has reached its AI validation quota for this window. Marked for manual review — retry shortly to attempt validation again.",
            },
          ] satisfies SubmissionFlag[],
          metadata: reviewMeta as any,
        })
        .eq("id", submissionId)
      clearTimeout(deadlineTimer)
      return
    }

    await admin.from("submissions").update({ status: "parsing" }).eq("id", submissionId)

    // ── Stage 1: Fetch + Parse ────────────────────────────────────────────
    let text = ""
    let truncated = false
    let parseWarning: string | undefined
    const isImage = submission.mime_type.startsWith("image/")
    const parseStart = Date.now()

    try {
      // Step 1: Fetch the private blob via the SDK (handles auth automatically).
      const { get: getBlob } = await import("@/lib/r2")
      console.log("[pipeline] fetching blob for", submissionId, "mime:", submission.mime_type)

      const blobResult = await getBlob(submission.blob_url)
      if (!blobResult || !blobResult.stream) {
        throw new Error(`blob stream is missing for: ${submission.blob_url}`)
      }

      // Step 2: Read the stream into a Buffer for the parsers.
      const chunks: Uint8Array[] = []
      // @ts-ignore - blobResult.stream is a Node.js Readable in this environment
      for await (const chunk of blobResult.stream) {
        chunks.push(chunk)
      }
      const buf = Buffer.concat(chunks)
      console.log("[pipeline] downloaded", buf.length, "bytes")

      // Step 3: Extract text from the document.
      if (isImage) {
        // Vision-only path. Tesseract.js fallback was removed because its
        // WASM cold-start (5–15s) blows the function budget on Hobby.
        // If vision fails, we mark needs_review instead of guessing.
        console.log("[pipeline] image detected — using vision model")
        try {
          const vision = await describeImage(buf, submission.mime_type, { abortSignal })
          text = vision.text || ""
          truncated = false
          console.log("[pipeline] vision extraction completed, length:", text.length)
        } catch (visionErr) {
          const msg = visionErr instanceof Error ? visionErr.message : String(visionErr)
          console.error("[pipeline] vision extraction failed", msg)
          const reviewMeta: { validation_outcome: ValidationOutcome; review_reason: ReviewReason } = {
            validation_outcome: "needs_review",
            review_reason: "ocr_failed",
          }
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
              metadata: reviewMeta as any,
            })
            .eq("id", submissionId)
          return
        }
      } else {
        // Non-image: native parsers (PDF, DOCX, PPTX).
        console.log("[pipeline] starting extractText...")
        const parsed = await extractText(buf, submission.mime_type)
        console.log("[pipeline] extractText completed")
        text = parsed.text
        truncated = parsed.truncated
        parseWarning = parsed.warning
      }

      console.log("[pipeline] extracted text length:", text.length, "truncated:", truncated)

      const normalizedText = text.replace(/\s+/g, " ").trim()
      const readableCharCount = Array.from(normalizedText.matchAll(/[\p{L}\p{N}]/gu)).length

      if (!normalizedText || readableCharCount === 0) {
        const reviewMeta: { validation_outcome: ValidationOutcome; review_reason: ReviewReason } = {
          validation_outcome: "needs_review",
          review_reason: "no_text",
        }
        const reviewFlags: SubmissionFlag[] = [
          {
            severity: "warn" as const,
            message: "Could not extract readable text from the file.",
          },
        ]
        if (parseWarning) {
          reviewFlags.push({
            severity: "info",
            message: parseWarning,
          })
        }
        await admin
          .from("submissions")
          .update({
            status: "needs_review",
            flags: reviewFlags as unknown as any,
            metadata: reviewMeta as any,
          })
          .eq("id", submissionId)
        return
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error(
        "[pipeline] parse error for submission",
        submissionId,
        "error:",
        errorMsg,
        err instanceof Error ? err.stack : "",
      )
      await admin
        .from("submissions")
        .update({
          status: "failed",
          flags: [
            { severity: "fail" as const, message: `Parse Error: ${errorMsg}` },
          ] satisfies SubmissionFlag[],
        })
        .eq("id", submissionId)
      return
    }

    timing.parse_ms = Date.now() - parseStart

    // Bail early if the parse already used most of our budget.
    if (remaining() < 5_000) {
      console.warn("[pipeline] parse stage exhausted budget for", submissionId)
      const reviewMeta: { validation_outcome: ValidationOutcome; review_reason: ReviewReason } = {
        validation_outcome: "needs_review",
        review_reason: "budget_exhausted",
      }
      await admin
        .from("submissions")
        .update({
          status: "needs_review",
          extracted_text: text.slice(0, EXTRACTED_TEXT_PREVIEW_CHARS),
          flags: [
            {
              severity: "warn" as const,
              message:
                "Document parsing took too long. Marked for manual review — please retry to attempt full validation.",
            },
          ] satisfies SubmissionFlag[],
          metadata: { ...reviewMeta, timing, total_ms: Date.now() - pipelineStart } as any,
        })
        .eq("id", submissionId)
      return
    }

    // We already checked the LLM rate limit pre-parse at Stage 0. The window
    // is sliding so a flood of concurrent submissions could still tip us over
    // here, but in practice the pre-parse check + parse latency is enough of
    // a gate. If you observe new "limit exceeded" errors during validation,
    // re-introduce the post-parse `llmLimiter().limit()` check here.
    await admin
      .from("submissions")
      .update({ status: "validating", extracted_text: text.slice(0, EXTRACTED_TEXT_PREVIEW_CHARS) })
      .eq("id", submissionId)

    // ── Stage 3: Load rules ─────────────────────────────────────────────
    // Pull team rules + (if any) the parent task as a synthesised rule so the
    // manager's per-task instructions are evaluated alongside global ones.
    const [{ data: rulesData }, taskRow] = await Promise.all([
      admin
        .from("validation_rules")
        .select("*")
        .or(`team_id.eq.${submission.team_id},team_id.is.null`)
        .eq("enabled", true),
      submission.task_id
        ? admin.from("tasks").select("*").eq("id", submission.task_id).maybeSingle()
        : Promise.resolve({ data: null as Task | null }),
    ])

    const rules = (rulesData ?? []) as ValidationRule[]
    const task = (taskRow?.data as Task | null) ?? null

    // If the task explicitly lists rule_ids, restrict to only those rules.
    // null  → no restriction (use all enabled rules — backward-compatible default)
    // []    → skip all standing rules entirely
    // [id…] → keep only the rules whose id appears in the list
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
        rule_type: "scored",
        threshold: 70,
        weight: 2,
        enabled: true,
        created_by: task.manager_id,
        created_at: task.created_at,
        updated_at: task.updated_at,
      })
    }

    // ── P3: Handle zero-rule case explicitly ────────────────────────────
    if (filteredRules.length === 0) {
      const reviewMeta: { validation_outcome: ValidationOutcome; review_reason: ReviewReason } = {
        validation_outcome: "needs_review",
        review_reason: "no_rules",
      }
      await admin
        .from("submissions")
        .update({
          status: "needs_review",
          score: null,
          summary: "",
          extracted_text: text.slice(0, EXTRACTED_TEXT_PREVIEW_CHARS),
          flags: [
            {
              severity: "info" as const,
              message:
                "No validation rules are configured for this team. Please ask your manager to set up validation rules, then retry.",
            },
          ] satisfies SubmissionFlag[],
          metadata: {
            ...reviewMeta,
            rules_evaluated: 0,
            had_task: Boolean(task),
            truncated,
            timing,
            total_ms: Date.now() - pipelineStart,
          } as any,
        })
        .eq("id", submissionId)
      return
    }

    // Clean up any old runs before generating new ones.
    await admin.from("validation_runs").delete().eq("submission_id", submissionId)

    // ── Stage 4: Run rules ──────────────────────────────────────────────
    // Bound concurrency: with no cap, a team that has 30+ rules would fan out
    // 30 simultaneous LLM calls per submission and tip the rate limiter into
    // failure mode.
    const ruleLimit = pLimit(Math.max(1, RULE_CONCURRENCY))
    const rulesStart = Date.now()
    const safetyBlockedRules: string[] = []
    const ruleOutputs = await Promise.all(
      filteredRules.map((rule) =>
        ruleLimit(async () => {
          // Skip remaining rules if we've blown the budget — better to mark
          // the submission needs_review than to be killed mid-write.
          if (abortSignal.aborted || remaining() < 3_000) {
            return null
          }
          try {
            return await runRule(text, rule, { truncated, abortSignal })
          } catch (err) {
            // Safety-filter rejections are permanent. Track them separately
            // so we can surface a clear "needs_review: safety_filter" outcome
            // rather than treating them as a generic transient skip.
            if ((err as any)?.code === "SAFETY_FILTER" || isSafetyFilterError(err)) {
              safetyBlockedRules.push(rule.rule_name)
              console.warn("[pipeline] rule blocked by safety filter", rule.rule_name)
            } else {
              console.error("[pipeline] rule failed", rule.rule_name, err)
            }
            return null
          }
        }),
      ),
    )
    timing.rules_ms = Date.now() - rulesStart

    const successful = ruleOutputs.filter((r): r is NonNullable<typeof r> => Boolean(r))
    const skipped = filteredRules.length - successful.length

    // ── P8: All rules failed → explicit failure ─────────────────────────
    if (successful.length === 0 && filteredRules.length > 0) {
      const reasonMsg = abortSignal.aborted
        ? `The validation pipeline ran out of time before any rule completed. Please retry.`
        : `All ${filteredRules.length} validation rules failed to execute. The AI service may be temporarily unavailable. Please retry later.`
      await admin
        .from("submissions")
        .update({
          status: "failed",
          score: null,
          summary: "",
          extracted_text: text.slice(0, EXTRACTED_TEXT_PREVIEW_CHARS),
          flags: [
            { severity: "fail" as const, message: reasonMsg },
          ] satisfies SubmissionFlag[],
          metadata: {
            rules_evaluated: 0,
            rules_attempted: filteredRules.length,
            had_task: Boolean(task),
            truncated,
            timing,
            total_ms: Date.now() - pipelineStart,
          },
        })
        .eq("id", submissionId)
      return
    }

    // Persist validation_runs only for real (non-synthetic) rule rows.
    const persistable = successful.filter((r) => !r.rule_id.startsWith("task:"))
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

    // Weighted aggregate score (rounded to integer for cleaner UI; the raw
    // per-rule scores are still in `validation_runs` for audit).
    const totalWeight = successful.reduce((s, r) => s + Number(r.weight || 1), 0) || 1
    const aggScore = Math.round(
      successful.reduce((s, r) => s + Number(r.score) * Number(r.weight || 1), 0) / totalWeight,
    )

    const allPassed = successful.length > 0 && successful.every((r) => r.pass)
    const anyHardFail = successful.some((r) => r.flags.some((f) => f.severity === "fail"))

    // ── Skip-tolerance policy ───────────────────────────────────────────
    // Old behaviour: ANY skipped rule → needs_review. That was too strict —
    // production teams with 20+ rules where one transient hiccup occurred
    // would always land in manual review. New policy:
    //   - >10% of rules skipped, OR
    //   - any high-weight (weight >= 2) rule skipped, OR
    //   - safety filter blocked any rule
    // → needs_review. Otherwise we trust the score from the successful
    // rules and let the normal pass/fail logic decide.
    const skipRatio = filteredRules.length > 0 ? skipped / filteredRules.length : 0
    const successfulIds = new Set(successful.map((r) => r.rule_id))
    const skippedHighWeight = filteredRules.some(
      (r) => !successfulIds.has(r.id) && Number(r.weight || 1) >= 2,
    )
    const skipsForceReview =
      skipped > 0 && (skipRatio > 0.1 || skippedHighWeight || safetyBlockedRules.length > 0)

    // ── Stage 5: Summary + predictive flags ─────────────────────────────
    let summary = ""
    let predictive: string[] = []
    const summaryStart = Date.now()
    // Skip the summary if we're nearly out of budget; the rule results are
    // more important than a nice summary line.
    if (!abortSignal.aborted && remaining() > 8_000) {
      try {
        const s = await summarize(text, { truncated, abortSignal })
        summary = s.summary
        predictive = s.predictive_flags
      } catch (err) {
        console.error("[pipeline] summary failed", err)
      }
    } else {
      console.warn("[pipeline] skipping summary — budget exhausted")
    }
    timing.summary_ms = Date.now() - summaryStart

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

    if (safetyBlockedRules.length > 0) {
      aggregateFlags.unshift({
        severity: "warn",
        message: `AI safety filter blocked ${safetyBlockedRules.length} rule(s) (${safetyBlockedRules
          .slice(0, 3)
          .join(", ")}${safetyBlockedRules.length > 3 ? "…" : ""}). The document was not evaluated against those rules — please review manually.`,
      })
    }

    if (skipped > safetyBlockedRules.length) {
      const transientSkipped = skipped - safetyBlockedRules.length
      aggregateFlags.unshift({
        severity: "warn",
        message: `${transientSkipped} of ${filteredRules.length} rule(s) were skipped because the validation budget ran out or the AI service hiccuped. Retry to evaluate them.`,
      })
    }

    // Record per-rule latency for observability.
    timing.rules_detail = successful.map((r) => ({
      rule_id: r.rule_id,
      rule_name: r.rule_name,
      latency_ms: r.latency_ms,
    })) as unknown as number // type coerce for metadata

    // ── Compute the AI validation outcome FIRST, independent of timeliness.
    // This is what managers care about: did the AI think the work passed?
    // Then layer the late_submitted status on top so the headline status
    // reflects the assignment lifecycle without losing the AI verdict.
    let validationOutcome: ValidationOutcome
    let reviewReason: ReviewReason | null = null

    if (skipsForceReview) {
      validationOutcome = "needs_review"
      reviewReason = safetyBlockedRules.length > 0 ? "safety_filter" : "partial_validation"
    } else if (allPassed && !anyHardFail) {
      validationOutcome = "passed"
    } else if (anyHardFail) {
      validationOutcome = "failed"
    } else {
      // Mix of passes and non-fail-severity warnings — defer to manager.
      validationOutcome = "needs_review"
      reviewReason = "warnings_present"
    }

    // The headline submission status:
    //   - is_late: keep "late_submitted" so the assignment lifecycle stays
    //     accurate. The AI verdict is still surfaced via validation_outcome.
    //   - otherwise: mirror validation_outcome onto the row's status.
    const finalStatus: Submission["status"] = submission.is_late
      ? "late_submitted"
      : validationOutcome === "passed"
        ? "passed"
        : validationOutcome === "failed"
          ? "failed"
          : "needs_review"

    timing.total_ms = Date.now() - pipelineStart

    await admin
      .from("submissions")
      .update({
        status: finalStatus,
        score: aggScore,
        summary,
        flags: aggregateFlags as unknown as any,
        extracted_text: text.slice(0, EXTRACTED_TEXT_PREVIEW_CHARS),
        metadata: {
          validation_outcome: validationOutcome,
          review_reason: reviewReason,
          rules_evaluated: persistable.length,
          rules_skipped: skipped,
          rules_safety_blocked: safetyBlockedRules.length,
          topics: predictive,
          truncated,
          had_task: Boolean(task),
          timing,
        },
      })
      .eq("id", submissionId)

    // Mirror status onto task_assignment so the member view stays in sync.
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

    // ---- Credit accounting ----
    try {
      const uploaderId = submission.uploader_id;
      // Auto-advance period if expired
      await admin.rpc("maybe_reset_period", { p_user_id: uploaderId }).maybeSingle();
      
      const { data: creditRow } = await admin
        .from("ai_credit_limits")
        .select("is_unlimited, period_type")
        .eq("user_id", uploaderId)
        .maybeSingle();
        
      const isUnlimited = creditRow?.is_unlimited ?? false;
      const creditsToDeduct = 1; // 1 credit per submission validation

      if (creditRow) {
        // Track usage for everyone, even unlimited admins, so we have accurate
        // system-wide usage metrics and top consumer track records.
        const { error: incErr } = await admin.rpc("increment_ai_usage", {
          p_user_id: uploaderId,
          p_credits: creditsToDeduct,
          p_event_type: "llm_validation",
          p_model: successful.length > 0 ? successful[0].model : "pipeline",
        });
        
        if (incErr) {
          console.error("[pipeline] credit accounting RPC failed:", incErr.message);
        }
      }
    } catch (acctErr: any) {
      console.error("[pipeline] credit accounting failed:", acctErr.message);
    }
  } finally {
    clearTimeout(deadlineTimer)
  }
}
