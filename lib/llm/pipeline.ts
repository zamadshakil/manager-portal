import { createAdminClient } from "@/lib/supabase/admin"
import { extractText } from "@/lib/parse"
import { runRule, summarize } from "@/lib/llm/validate"
import { llmLimiter } from "@/lib/redis"
import type { Submission, SubmissionFlag, ValidationRule } from "@/lib/types"

/**
 * End-to-end async validation pipeline. Called from `after()` in the upload
 * Server Action so the user sees an instant "queued" response while we:
 *   1. fetch the file from Vercel Blob
 *   2. extract plain text via the right parser for the MIME type
 *   3. run every enabled validation_rule for the team in parallel
 *   4. compute a weighted score, summary, and predictive flags
 *   5. write validation_runs and update the submission row
 */
export async function processSubmission(submissionId: string) {
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
  try {
    const res = await fetch(submission.blob_url)
    if (!res.ok) throw new Error(`blob fetch ${res.status}`)
    const arrayBuf = await res.arrayBuffer()
    const buf = Buffer.from(arrayBuf)
    const parsed = await extractText(buf, submission.mime_type)
    text = parsed.text
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
    console.error("[pipeline] parse error", err)
    await admin
      .from("submissions")
      .update({
        status: "failed",
        flags: [{ severity: "fail" as const, message: "Document could not be parsed." }] satisfies SubmissionFlag[],
      })
      .eq("id", submissionId)
    return
  }

  await admin
    .from("submissions")
    .update({ status: "validating", extracted_text: text })
    .eq("id", submissionId)

  const { data: rulesData } = await admin
    .from("validation_rules")
    .select("*")
    .eq("team_id", submission.team_id)
    .eq("enabled", true)

  const rules = (rulesData ?? []) as ValidationRule[]

  const ruleOutputs = await Promise.all(
    rules.map(async (rule) => {
      try {
        return await runRule(text, rule)
      } catch (err) {
        console.error("[pipeline] rule failed", rule.rule_name, err)
        return null
      }
    }),
  )

  const successful = ruleOutputs.filter((r): r is NonNullable<typeof r> => Boolean(r))

  // Insert validation_runs.
  if (successful.length > 0) {
    await admin.from("validation_runs").insert(
      successful.map((r) => ({
        submission_id: submissionId,
        rule_id: r.rule_id,
        model: r.model,
        prompt_version: "v1",
        raw_output: r.raw as Record<string, unknown>,
        pass: r.pass,
        score: r.score,
        reasons: r.reasons,
        flags: r.flags,
        latency_ms: r.latency_ms,
      })),
    )
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
    const s = await summarize(text)
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

  const finalStatus = allPassed && !anyHardFail ? "passed" : anyHardFail ? "failed" : "needs_review"

  await admin
    .from("submissions")
    .update({
      status: finalStatus,
      score: Number(aggScore.toFixed(2)),
      summary,
      flags: aggregateFlags,
      metadata: {
        rules_evaluated: successful.length,
        topics: predictive,
      },
    })
    .eq("id", submissionId)
}
