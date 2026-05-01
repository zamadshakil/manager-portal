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
        admin.from("validation_rules").select("*").eq("team_id", sub.team_id).eq("enabled", true),
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
    const { text, truncated } = await step.run("extract-text", async () => {
      let extracted = "";
      let isTruncated = false;

      const res = await fetch(submission.blob_url);
      const buffer = Buffer.from(await res.arrayBuffer());

      if (submission.blob_url.startsWith("data:image/") || submission.mime_type.startsWith("image/")) {
        const { text: visionText, notes } = await describeImage(buffer, submission.mime_type || "image/jpeg");
        extracted = visionText + (notes ? `\n\n[Vision Notes: ${notes}]` : "");
      } else {
        const { text: parsed, truncated: t } = await extractText(buffer, submission.mime_type);
        extracted = parsed;
        isTruncated = t;
      }
      return { text: extracted, truncated: isTruncated };
    });

    if (!text || text.trim().length === 0) {
      await step.run("fail-empty-text", async () => {
        const admin = createAdminClient();
        await admin.from("submissions").update({
          status: "needs_review",
          flags: [{ severity: "fail", message: "Failed to extract text from the document." }]
        }).eq("id", submissionId);
      });
      return { status: "empty text" };
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

    // Stage 4: Run Rules Concurrently
    const ruleOutputs = await Promise.all(
      filteredRules.map(rule => 
        // Inngest steps run independently. If one rule fails (rate limit), Inngest retries just that step.
        step.run(`run-rule-${rule.id.replace(/[^a-zA-Z0-9-]/g, '-')}`, async () => {
          return await runRule(text, rule, { truncated });
        })
      )
    );

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
      if (successful.length > 0) {
        await admin.from("validation_runs").insert(
          successful.map(r => ({
            submission_id: submissionId,
            rule_id: r.rule_id.startsWith("task:") ? null : r.rule_id,
            rule_name: r.rule_name,
            pass: r.pass,
            score: r.score,
            reasons: r.reasons,
            flags: r.flags,
            prompt_version: PROMPT_VERSION,
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
