import "server-only"
import pLimit from "p-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { extractText } from "@/lib/parse"
import { runRule, summarize, describeImage, PROMPT_VERSION } from "@/lib/llm/validate"
import { llmLimiter, getRedis } from "@/lib/redis"
import type { Submission, SubmissionFlag, ValidationRule, Task } from "@/lib/types"

// Cap concurrent LLM calls per submission. Without this, a team with 20+
// rules would issue 20+ simultaneous Groq requests and trip rate limits
// despite our own per-team Upstash limiter (which gates submissions, not
// fan-out within a single submission).
const RULE_CONCURRENCY = 5

/**
 * End-to-end async validation pipeline. Called from `after()` in the upload
 * Server Action so the user sees an instant "queued" response while we:
 *   1. fetch the file from Vercel Blob
 *   2. extract plain text via the right parser for the MIME type
 *   3. (low-confidence images) fall back to a Groq vision model
 *   4. run every enabled validation_rule for the team — plus the parent
 *      task's `instructions` if this submission is for a task — in parallel
 *   5. compute a weighted score, summary, and predictive flags
 *   6. write validation_runs and update the submission row
 *
 * Idempotency: a Redis SETNX lock prevents double-runs (e.g. a duplicate
 * `after()` invocation, manual retry collisions, or cron rescues).
 */
export async function processSubmission(submissionId: string) {
  const admin = createAdminClient()
  const redis = (() => {
    try {
      return getRedis()
    } catch {
      return null
    }
  })()

  // Idempotency lock — first writer wins for 10 minutes.
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

  try {
    await runPipeline(submissionId)
  } finally {
    if (redis) await redis.del(`pipeline:lock:${submissionId}`).catch(() => {})
  }
}

async function runPipeline(submissionId: string) {
  const admin = createAdminClient()

  const { data: subData, error: subError } = await admin
    .from("submissions")
    .select("*")
    .eq("id", submissionId)
    .single()
  if (subError || !subData) {
    console.error("[pipeline] submission not found", submissionId, subError)
    return
  }
  const submission = subData as Submission

  // Rate limit per team to protect the LLM budget.
  const limit = await llmLimiter().limit(`team:${submission.team_id}`)
  if (!limit.success) {
    await admin
      .from("submissions")
      .update({
        status: "needs_review",
        flags: [
          {
            severity: "warn" as const,
            message: "LLM quota reached for this team. Marked for manual review.",
          },
        ] satisfies SubmissionFlag[],
      })
      .eq("id", submissionId)
    return
  }

  await admin.from("submissions").update({ status: "parsing" }).eq("id", submissionId)

  let text = ""
  let truncated = false
  try {
    // Step 1: Fetch the private blob via the SDK (handles auth automatically).
    const { get: getBlob } = await import("@vercel/blob")
    console.log("[pipeline] fetching blob for", submissionId, "mime:", submission.mime_type)

    const blobResult = await getBlob(submission.blob_url, {
      access: "private" as const,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    })
    console.log("[pipeline] getBlob completed")
    if (!blobResult || !blobResult.stream) {
      throw new Error(`blob stream is missing for: ${submission.blob_url}`)
    }

    // Step 2: Read the stream into a Buffer for the parsers.
    console.log("[pipeline] reading stream")
    const chunks: Uint8Array[] = []
    const reader = blobResult.stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    const buf = Buffer.concat(chunks)
    console.log("[pipeline] downloaded", buf.length, "bytes")

    // Step 3: Extract text from the document.
    console.log("[pipeline] starting extractText...")
    const parsed = await extractText(buf, submission.mime_type)
    console.log("[pipeline] extractText completed")
    text = parsed.text
    truncated = parsed.truncated
    console.log("[pipeline] extracted text length:", text.length, "truncated:", truncated)

    // Vision fallback for low-confidence OCR / sparse text on images.
    const isImage = submission.mime_type.startsWith("image/")
    const ocrWeak =
      isImage &&
      (text.trim().length < 60 ||
        (parsed.ocrConfidence !== undefined && parsed.ocrConfidence < 60))
    if (ocrWeak) {
      try {
        const vision = await describeImage(buf, submission.mime_type)
        if (vision.text && vision.text.length > text.length) {
          text = vision.text
          truncated = false
        }
      } catch (visionErr) {
        console.error("[pipeline] vision fallback failed", visionErr)
      }
    }

    if (!text || text.trim().length < 20) {
      await admin
        .from("submissions")
        .update({
          status: "needs_review",
          flags: [
            {
              severity: "warn" as const,
              message: parsed.warning ?? "Could not extract enough text from the file.",
            },
          ] satisfies SubmissionFlag[],
        })
        .eq("id", submissionId)
      return
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error("[pipeline] parse error for submission", submissionId, "error:", errorMsg, err instanceof Error ? err.stack : "")
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

  await admin
    .from("submissions")
    .update({ status: "validating", extracted_text: text })
    .eq("id", submissionId)

  // Pull team rules + (if any) the parent task as a synthesised rule so the
  // manager's per-task instructions are evaluated alongside global ones.
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
      threshold: 70,
      weight: 2,
      enabled: true,
      created_by: task.manager_id,
      created_at: task.created_at,
      updated_at: task.updated_at,
    })
  }

  // Run rules with bounded concurrency. p-limit lets fast rules complete
  // while slower ones are still in-flight, without all of them racing the
  // Groq quota at once.
  const limit = pLimit(RULE_CONCURRENCY)
  const ruleOutputs = await Promise.all(
    filteredRules.map((rule) =>
      limit(async () => {
        try {
          return await runRule(text, rule, { truncated })
        } catch (err) {
          console.error("[pipeline] rule failed", rule.rule_name, err)
          return null
        }
      }),
    ),
  )

  const successful = ruleOutputs.filter((r): r is NonNullable<typeof r> => Boolean(r))

  // Persist validation_runs only for real (non-synthetic) rule rows. We
  // INSERT the new rows *first* and only delete the prior history once the
  // new rows are durable — that way a transient Postgres failure can never
  // leave a submission with zero run history (which previously broke the
  // submission detail page until a manual re-run).
  const persistable = successful.filter((r) => !r.rule_id.startsWith("task:"))
  if (persistable.length > 0) {
    const { error: insertErr } = await admin.from("validation_runs").insert(
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
    if (insertErr) {
      console.error("[pipeline] failed to insert validation_runs", insertErr)
      // Bail out rather than nuking the existing run history below.
      throw insertErr
    }
    // Now safe to drop older runs. We keep only the most recent batch by
    // matching on submission_id + a `created_at` cutoff right before our
    // INSERT timestamp range; in practice all rows we just inserted have
    // a later created_at than the previous batch, so the simpler form is
    // safe and idempotent.
    await admin
      .from("validation_runs")
      .delete()
      .eq("submission_id", submissionId)
      .not("prompt_version", "is", null)
      .lt("created_at", new Date(Date.now() - 1000).toISOString())
  }

  // Weighted aggregate score.
  const totalWeight = successful.reduce((s, r) => s + Number(r.weight || 1), 0) || 1
  const aggScore =
    successful.reduce((s, r) => s + Number(r.score) * Number(r.weight || 1), 0) / totalWeight

  const allPassed = successful.length > 0 && successful.every((r) => r.pass)
  const anyHardFail = successful.some((r) => r.flags.some((f) => f.severity === "fail"))

  // Summary + predictive flags.
  let summary = ""
  let predictive: string[] = []
  try {
    const s = await summarize(text, { truncated })
    summary = s.summary
    predictive = s.predictive_flags
  } catch (err) {
    console.error("[pipeline] summary failed", err)
  }

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

  // Final status preserves "late_submitted" if the row was already marked late
  // at upload time — the AI verdict still influences score/flags but a late
  // submission never reverts to plain "passed".
  let finalStatus: Submission["status"]
  if (submission.is_late) {
    finalStatus = "late_submitted"
  } else {
    finalStatus = allPassed && !anyHardFail ? "passed" : anyHardFail ? "failed" : "needs_review"
  }

  await admin
    .from("submissions")
    .update({
      status: finalStatus,
      score: Number(aggScore.toFixed(2)),
      summary,
      flags: aggregateFlags,
      metadata: {
        rules_evaluated: persistable.length,
        topics: predictive,
        truncated,
        had_task: Boolean(task),
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
}
