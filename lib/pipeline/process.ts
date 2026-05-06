import { createAdminClient } from "@/lib/supabase/admin";
import { extractText } from "@/lib/parse";
import { runRule, summarize, describeImage, PROMPT_VERSION } from "@/lib/llm/validate";
import { indexDocument, joinContent } from "@/lib/smart-ai/indexer";
import type { Submission, SubmissionFlag, ValidationRule, Task } from "@/lib/types";

const EXTRACTED_TEXT_PREVIEW_CHARS = 2_000;

/**
 * Run the full AI validation pipeline for a submission.
 *
 * This is a plain async function that replaces the old Inngest step-based
 * orchestration. On Railway the app runs as a persistent Node process so
 * there is no serverless timeout to work around — we can execute the entire
 * pipeline in a single invocation.
 *
 * The caller should fire-and-forget (`processSubmission(id).catch(…)`) so
 * the HTTP response returns immediately while the pipeline runs in the
 * background.
 */
export async function processSubmission(submissionId: string): Promise<{ status: string; error?: string }> {
  try {
    // ── Stage 1: Load Submission ──────────────────────────────────────
    const admin = createAdminClient();
    const { data: sub } = await admin
      .from("submissions")
      .select("*")
      .eq("id", submissionId)
      .single();

    if (!sub || ["passed", "failed", "late_submitted"].includes(sub.status)) {
      return { status: "skipped or completed" };
    }

    const submission = sub as Submission;

    const [{ data: rulesData }, taskRow] = await Promise.all([
      admin.from("validation_rules").select("*").or(`team_id.eq.${submission.team_id},team_id.is.null`).eq("enabled", true),
      submission.task_id ? admin.from("tasks").select("*").eq("id", submission.task_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);

    const task = (taskRow?.data as Task | null) ?? null;
    const rules = (rulesData ?? []) as ValidationRule[];

    // ── Stage 2: Set status to parsing ────────────────────────────────
    await admin.from("submissions").update({ status: "parsing" }).eq("id", submissionId);

    // ── Stage 3: Extract Text ─────────────────────────────────────────
    let extracted = "";
    let isTruncated = false;
    let extractError: string | null = null;

    try {
      let buffer: Buffer;

      try {
        const { get: getBlob } = await import("@/lib/r2");
        const blobResult = await getBlob(submission.blob_url);

        if (blobResult?.stream) {
          const chunks: Uint8Array[] = [];
          for await (const chunk of blobResult.stream) {
            chunks.push(chunk);
          }
          buffer = Buffer.concat(chunks);
        } else {
          extractError = "Blob is inaccessible — no stream available.";
          buffer = Buffer.alloc(0);
        }
      } catch (blobErr: any) {
        extractError = `Blob completely inaccessible: ${blobErr.message}`;
        buffer = Buffer.alloc(0);
      }

      if (!extractError && (!buffer || buffer.length === 0)) {
        extractError = "Downloaded blob is empty.";
      }

      if (!extractError) {
        console.log("[pipeline] downloaded blob:", buffer!.length, "bytes");

        if (submission.blob_url.startsWith("data:image/") || submission.mime_type.startsWith("image/")) {
          const { text: visionText, notes } = await describeImage(buffer!, submission.mime_type || "image/jpeg");
          extracted = visionText + (notes ? `\n\n[Vision Notes: ${notes}]` : "");
        } else {
          const { text: parsed, truncated: t } = await extractText(buffer!, submission.mime_type);
          extracted = parsed;
          isTruncated = t;
        }
      }
    } catch (err: any) {
      extractError = `Extraction failed: ${err.message || "Unknown error"}`;
    }

    if (!extractError && (!extracted || extracted.trim().length === 0)) {
      extractError = "No text could be extracted from the document.";
    }

    if (extractError) {
      await admin.from("submissions").update({
        status: "needs_review",
        flags: [{ severity: "fail", message: extractError }],
      }).eq("id", submissionId);
      return { status: "extraction_failed", error: extractError };
    }

    // ── Stage 4: Set status to validating ─────────────────────────────
    await admin.from("submissions").update({
      status: "validating",
      extracted_text: extracted.slice(0, EXTRACTED_TEXT_PREVIEW_CHARS),
    }).eq("id", submissionId);

    // ── Stage 5: Filter & Prepare Rules ───────────────────────────────
    const filteredRules = task && task.rule_ids !== null
      ? rules.filter((r) => (task.rule_ids as string[]).includes(r.id))
      : [...rules];

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
      });
    }

    if (filteredRules.length === 0) {
      await admin.from("submissions").update({
        status: "needs_review",
        score: null,
        flags: [{ severity: "info", message: "No validation rules configured." }],
      }).eq("id", submissionId);
      return { status: "no rules" };
    }

    // ── Stage 6: Run Rules Sequentially ───────────────────────────────
    // Running one at a time avoids slamming Gemini with concurrent requests
    // which triggers "high demand" rate limits.
    const ruleOutputs = [];
    for (const rule of filteredRules) {
      const result = await runRule(extracted, rule, { truncated: isTruncated });
      ruleOutputs.push(result);
    }

    const successful = ruleOutputs.filter((r): r is NonNullable<typeof r> => Boolean(r));

    // ── Stage 7: Summary ──────────────────────────────────────────────
    const summaryData = await summarize(extracted, { truncated: isTruncated });

    // ── Stage 8: Final Scoring & Save ─────────────────────────────────
    const aggregateFlags: SubmissionFlag[] = [
      ...successful.flatMap((r) => r.flags.map<SubmissionFlag>((f) => ({
        rule_id: r.rule_id, rule_name: r.rule_name, severity: f.severity, message: f.message,
      }))),
      ...summaryData.predictive_flags.map<SubmissionFlag>((p) => ({ severity: "info", message: `Predictive: ${p}` })),
    ];

    const maxPossibleScore = successful.reduce((acc, r) => acc + (r.weight || 1), 0) * 100;
    const actualScore = successful.reduce((acc, r) => acc + (r.score * (r.weight || 1)), 0);
    const finalScore = maxPossibleScore > 0 ? Math.round((actualScore / maxPossibleScore) * 100) : null;

    let finalStatus = submission.status === "late_submitted" ? "late_submitted" : "passed";
    if (finalScore !== null && finalScore < 80) finalStatus = "failed";
    if (aggregateFlags.some((f) => f.severity === "fail" || f.severity === "warn")) finalStatus = "needs_review";

    await admin.from("validation_runs").delete().eq("submission_id", submissionId);
    // Only persist real rules (not synthetic task-brief rules)
    const persistable = successful.filter((r) => !r.rule_id.startsWith("task:"));
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
      );
    }

    await admin.from("submissions").update({
      status: finalStatus as any,
      score: finalScore,
      summary: summaryData.summary,
      flags: aggregateFlags,
    }).eq("id", submissionId);

    // ── Stage 9: Reindex for RAG ──────────────────────────────────────
    // Best-effort — the submission is already saved.
    try {
      const { data: finalSub } = await admin
        .from("submissions")
        .select("id, team_id, uploader_id, title, status, score, summary, extracted_text, flags, task_id, is_late")
        .eq("id", submissionId)
        .single();

      if (finalSub) {
        await indexDocument({
          source_type: "submission",
          source_id: finalSub.id,
          team_id: finalSub.team_id,
          owner_id: finalSub.uploader_id,
          title: finalSub.title,
          content: joinContent([
            finalSub.title,
            finalSub.summary,
            finalSub.extracted_text,
            ((finalSub.flags as SubmissionFlag[] | null) ?? [])
              .map((f) => `[${f.severity}] ${f.rule_name ?? ""}: ${f.message}`)
              .join("\n"),
          ]),
          metadata: {
            status: finalSub.status,
            score: finalSub.score,
            task_id: finalSub.task_id,
            is_late: finalSub.is_late,
            flag_count: ((finalSub.flags as SubmissionFlag[] | null) ?? []).length,
          },
        });
      }
    } catch (err) {
      // Never fail the function over an indexing hiccup.
      console.warn("[pipeline] reindex-submission threw", err);
    }

    return { status: "completed" };
  } catch (fatalError: any) {
    // ── Crash recovery (replaces onFailureSubmissionFn) ──────────────
    console.error("[pipeline] fatal crash for submission", submissionId, fatalError);
    try {
      const admin = createAdminClient();
      await admin.from("submissions").update({
        status: "needs_review",
        score: null,
        flags: [{ severity: "fail", message: `AI Pipeline crashed: ${fatalError.message || "Unknown error"}` }],
      }).eq("id", submissionId);
    } catch (dbErr) {
      console.error("[pipeline] could not mark submission as failed in DB", dbErr);
    }
    return { status: "crashed", error: fatalError.message };
  }
}
