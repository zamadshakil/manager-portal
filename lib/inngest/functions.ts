import { inngest } from "./client";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractText } from "@/lib/parse";
import { runRule, summarize, describeImage, PROMPT_VERSION } from "@/lib/llm/validate";
import type { Submission, SubmissionFlag, ValidationRule, Task } from "@/lib/types";

const EXTRACTED_TEXT_PREVIEW_CHARS = 2_000;

export const processSubmissionFn = inngest.createFunction(
  { 
    id: "process-submission", 
    retries: 3,
    triggers: [{ event: "app/submission.process" }]
  },
  async ({ event, step }) => {
    const submissionId = event.data.submissionId;
    
    // Stage 1: Load Submission
    const { submission, task, rules } = await step.run("load-submission-and-rules", async () => {
      const admin = createAdminClient();
      const { data: sub } = await admin
        .from("submissions")
        .select("*")
        .eq("id", submissionId)
        .single();
      
      if (!sub || ["passed", "failed", "late_submitted"].includes(sub.status)) {
        return { submission: null, task: null, rules: [] };
      }

      const [{ data: rulesData }, taskRow] = await Promise.all([
        admin.from("validation_rules").select("*").or(`team_id.eq.${sub.team_id},team_id.is.null`).eq("enabled", true),
        sub.task_id ? admin.from("tasks").select("*").eq("id", sub.task_id).maybeSingle() : Promise.resolve({ data: null })
      ]);

      return {
        submission: sub as Submission,
        task: (taskRow?.data as Task | null) ?? null,
        rules: (rulesData ?? []) as ValidationRule[]
      };
    });

    if (!submission) return { status: "skipped or completed" };

    // Set status to parsing
    await step.run("update-status-parsing", async () => {
      const admin = createAdminClient();
      await admin.from("submissions").update({ status: "parsing" }).eq("id", submissionId);
    });

    // Stage 2: Extract Text
    const extractResult = await step.run("extract-text", async () => {
      let extracted = "";
      let isTruncated = false;

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
          return { text: "", truncated: false, error: "Blob is inaccessible — no stream available." };
        }
      } catch (blobErr: any) {
        return { text: "", truncated: false, error: `Blob completely inaccessible: ${blobErr.message}` };
      }

      if (!buffer || buffer.length === 0) {
        return { text: "", truncated: false, error: "Downloaded blob is empty." };
      }
      console.log("[inngest] downloaded blob:", buffer.length, "bytes");

      try {
        if (submission.blob_url.startsWith("data:image/") || submission.mime_type.startsWith("image/")) {
          const { text: visionText, notes } = await describeImage(buffer, submission.mime_type || "image/jpeg");
          extracted = visionText + (notes ? `\n\n[Vision Notes: ${notes}]` : "");
        } else {
          const { text: parsed, truncated: t } = await extractText(buffer, submission.mime_type);
          extracted = parsed;
          isTruncated = t;
        }
      } catch (err: any) {
        return { text: "", truncated: false, error: `Extraction failed: ${err.message || 'Unknown error'}` };
      }
      return { text: extracted, truncated: isTruncated, error: null };
    });

    const { text, truncated } = extractResult;
    let extractError: string | null = extractResult.error ?? null;

    if (!extractError && (!text || text.trim().length === 0)) {
      extractError = "No text could be extracted from the document.";
    }

    if (extractError) {
      await step.run("fail-extraction", async () => {
        const admin = createAdminClient();
        await admin.from("submissions").update({
          status: "needs_review",
          flags: [{ severity: "fail", message: extractError! }]
        }).eq("id", submissionId);
      });
      return { status: "extraction_failed", error: extractError };
    }

    // Set status to validating
    await step.run("update-status-validating", async () => {
      const admin = createAdminClient();
      await admin.from("submissions").update({ 
        status: "validating", 
        extracted_text: text.slice(0, EXTRACTED_TEXT_PREVIEW_CHARS) 
      }).eq("id", submissionId);
    });

    // Stage 3: Filter Rules
    const filteredRules = task && task.rule_ids !== null
      ? rules.filter(r => (task.rule_ids as string[]).includes(r.id))
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
      await step.run("no-rules", async () => {
        const admin = createAdminClient();
        await admin.from("submissions").update({
          status: "needs_review",
          score: null,
          flags: [{ severity: "info", message: "No validation rules configured." }]
        }).eq("id", submissionId);
      });
      return { status: "no rules" };
    }

    // Stage 4: Run Rules Sequentially
    // Running one at a time avoids slamming Gemini with concurrent requests
    // which triggers "high demand" rate limits. Each rule is still its own
    // Inngest step, so failures are retried independently.
    const ruleOutputs = [];
    for (const rule of filteredRules) {
      const result = await step.run(`run-rule-${rule.id.replace(/[^a-zA-Z0-9-]/g, '-')}`, async () => {
        return await runRule(text, rule, { truncated });
      });
      ruleOutputs.push(result);
    }

    const successful = ruleOutputs.filter((r): r is NonNullable<typeof r> => Boolean(r));

    // Stage 5: Summary
    const summaryData = await step.run("generate-summary", async () => {
      return await summarize(text, { truncated });
    });

    // Stage 6: Final Scoring & Save
    await step.run("finalize-submission", async () => {
      const admin = createAdminClient();
      
      const aggregateFlags: SubmissionFlag[] = [
        ...successful.flatMap((r) => r.flags.map<SubmissionFlag>((f) => ({
          rule_id: r.rule_id, rule_name: r.rule_name, severity: f.severity, message: f.message
        }))),
        ...summaryData.predictive_flags.map<SubmissionFlag>((p) => ({ severity: "info", message: `Predictive: ${p}` }))
      ];

      const maxPossibleScore = successful.reduce((acc, r) => acc + (r.weight || 1), 0) * 100;
      const actualScore = successful.reduce((acc, r) => acc + (r.score * (r.weight || 1)), 0);
      const finalScore = maxPossibleScore > 0 ? Math.round((actualScore / maxPossibleScore) * 100) : null;
      
      let finalStatus = submission.status === "late_submitted" ? "late_submitted" : "passed";
      if (finalScore !== null && finalScore < 80) finalStatus = "failed";
      if (aggregateFlags.some(f => f.severity === "fail" || f.severity === "warn")) finalStatus = "needs_review";

      await admin.from("validation_runs").delete().eq("submission_id", submissionId);
      // Only persist real rules (not synthetic task-brief rules)
      const persistable = successful.filter(r => !r.rule_id.startsWith("task:"));
      if (persistable.length > 0) {
        await admin.from("validation_runs").insert(
          persistable.map(r => ({
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
          }))
        );
      }

      await admin.from("submissions").update({
        status: finalStatus as any,
        score: finalScore,
        summary: summaryData.summary,
        flags: aggregateFlags,
      }).eq("id", submissionId);
    });

    return { status: "completed" };
  }
);

export const onFailureSubmissionFn = inngest.createFunction(
  { 
    id: "handle-submission-failure",
    triggers: [{ event: "inngest/function.failed" }]
  },
  async ({ event, step }) => {
    const originalEvent = event.data.event;
    if (originalEvent.name === "app/submission.process") {
      const submissionId = originalEvent.data.submissionId;
      const errorMsg = event.data.error.message || "Unknown error";
      
      await step.run("mark-db-failed", async () => {
        const admin = createAdminClient();
        await admin.from("submissions").update({
          status: "needs_review",
          score: null,
          flags: [{ severity: "fail", message: `AI Pipeline crashed: ${errorMsg}` }]
        }).eq("id", submissionId);
      });
    }
  }
);

export const markMissedCronFn = inngest.createFunction(
  { id: "mark-missed-cron", triggers: [{ cron: "0 0 * * *" }] },
  async ({ step }) => {
    const result = await step.run("mark-missed-assignments-and-recover-stuck", async () => {
      const admin = createAdminClient();
      const nowIso = new Date().toISOString();
      
      // 1. Mark missed assignments for tasks that forbid lateness.
      const { data: overdue } = await admin
        .from("task_assignments")
        .select("id, task:tasks!inner(id, due_at, allow_late)")
        .eq("status", "assigned")
        .not("task.due_at", "is", null)
        .lt("task.due_at", nowIso);

      let missedCount = 0;
      const overdueRows = (overdue as unknown as any[]) || [];
      if (overdueRows.length > 0) {
        const toMiss = overdueRows
          .filter((row) => row.task.allow_late === false)
          .map((row) => row.id);

        if (toMiss.length > 0) {
          await admin
            .from("task_assignments")
            .update({ status: "missed" })
            .in("id", toMiss);
          missedCount = toMiss.length;
        }
      }

      // 2. Auto-fail stuck submissions (pipeline crash recovery).
      const stuckCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: stuck } = await admin
        .from("submissions")
        .update({
          status: "failed",
          flags: [
            {
              severity: "fail",
              message: "Validation pipeline timed out. Please retry.",
            },
          ],
        } as any)
        .in("status", ["queued", "parsing", "validating"])
        .lt("updated_at", stuckCutoff)
        .select("id");

      const out = {
        ok: true,
        missedCount,
        stuckRecovered: stuck?.length ?? 0,
      };

      try {
        const { recordTaskExecution } = await import("@/lib/upstash-scheduler");
        await recordTaskExecution("mark-missed", out);
      } catch (e) {
        console.error("Failed to record task execution", e);
      }

      return out;
    });

    return result;
  }
);
