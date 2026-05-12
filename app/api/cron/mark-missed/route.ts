import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRedis } from "@/lib/redis";
import { processSubmission } from "@/lib/llm/pipeline";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Max times the cron will auto-retry a `queued`-stuck submission before
 * giving up and marking it failed. Combined with `submissions.attempts`
 * (incremented in `runPipeline`), this caps AI-credit blast radius for a
 * row that genuinely can't be processed.
 */
const MAX_AUTO_RETRY_ATTEMPTS = 3;

/**
 * GET /api/cron/mark-missed
 *
 * Railway cron endpoint — replaces the old Inngest markMissedCronFn.
 * Configure Railway to hit this URL every 15 minutes.
 *
 * Protected by a CRON_SECRET header so only Railway (or you) can invoke it.
 * Set CRON_SECRET in your Railway environment variables and configure the
 * cron job to send it as: `Authorization: Bearer <CRON_SECRET>`
 */
export async function GET(request: Request) {
  // ── Auth guard ────────────────────────────────────────────────────
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron] CRON_SECRET is not configured — rejecting request for safety. Set CRON_SECRET in your environment variables.");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
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

    // 2. Recover stuck submissions (pipeline crash / missed-trigger recovery).
    //
    // Two-phase to avoid racing a still-running pipeline:
    //   a) Select rows in queued/parsing/validating older than 5 min (a
    //      healthy run completes in ~30-60s).
    //   b) Skip any row whose Redis lock `pipeline:lock:<id>` is still held
    //      — that lock is the authoritative "a worker is currently running"
    //      signal, with a 10-min TTL set by `processSubmission()`.
    //
    // For rows whose lock has expired or never existed (Redis unavailable,
    // server restart, missed client trigger, etc.) we partition by status:
    //
    //   - `queued` + attempts < MAX → auto-retry (likely a missed trigger;
    //      no AI work has happened yet, so a re-invoke is cheap and safe).
    //   - `queued` + attempts >= MAX → fail (probably a permanent issue).
    //   - `parsing` / `validating` → fail (AI work has started — retrying
    //      risks double-billing credits; the user can manually re-run).
    //
    // The retry runs inside `after()` so this cron response returns
    // quickly even if many rows need recovery.
    const stuckCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: stuckCandidates } = await admin
      .from("submissions")
      .select("id, status, attempts, team_id, uploader_id" as any)
      .in("status", ["queued", "parsing", "validating"])
      .lt("updated_at", stuckCutoff);

    let stuckRecoveredIds: string[] = [];
    let autoRetriedIds: string[] = [];
    const candidateRows = (stuckCandidates as any[]) || [];
    if (candidateRows.length > 0) {
      const redis = getRedis();
      const idsToFail: string[] = [];
      const idsToFailExhausted: string[] = [];
      const idsToRetry: { id: string; attempts: number; team_id: string; uploader_id: string }[] = [];

      for (const row of candidateRows) {
        // If Redis is unavailable, fall back to the old behaviour: assume
        // the pipeline is gone and recover the row. Better to surface a
        // stuck submission than leave it pending indefinitely.
        let lockHeld = false;
        if (redis) {
          try {
            const lock = await redis.get(`pipeline:lock:${row.id}`);
            lockHeld = lock !== null;
          } catch {
            lockHeld = false;
          }
        }
        if (lockHeld) continue;

        const attempts = Number(row.attempts ?? 0);
        if (row.status === "queued") {
          if (attempts < MAX_AUTO_RETRY_ATTEMPTS) {
            idsToRetry.push({
              id: row.id,
              attempts,
              team_id: row.team_id,
              uploader_id: row.uploader_id,
            });
          } else {
            idsToFailExhausted.push(row.id);
          }
        } else {
          // parsing / validating — AI work likely started, don't double-bill.
          idsToFail.push(row.id);
        }
      }

      // Auto-retry queued-stuck rows. Bump updated_at so the next cron pass
      // won't immediately re-select the same rows if the retry hasn't yet
      // updated status itself.
      if (idsToRetry.length > 0) {
        const retryIds = idsToRetry.map((r) => r.id);
        await admin
          .from("submissions")
          .update({ updated_at: new Date().toISOString() } as any)
          .in("id", retryIds);

        for (const row of idsToRetry) {
          after(() => {
            processSubmission(row.id).catch((err) => {
              console.error("[cron] auto-retry pipeline crash for", row.id, err);
            });
          });
          // Best-effort audit log. Failures are non-fatal.
          void logActivity({
            actorId: null,
            teamId: row.team_id,
            action: "submission.auto_retried",
            entityType: "submission",
            entityId: row.id,
            metadata: { attempts: row.attempts, source: "cron" },
          });
        }
        autoRetriedIds = retryIds;
      }

      // Fail rows that are mid-pipeline (parsing/validating) or have
      // exhausted retries. Use distinct messages so admins can diagnose.
      if (idsToFail.length > 0) {
        await admin
          .from("submissions")
          .update({
            status: "failed",
            flags: [
              {
                severity: "fail",
                message:
                  "Validation pipeline stalled mid-run. Please retry from the submission detail page.",
              },
            ],
          } as any)
          .in("id", idsToFail);
      }
      if (idsToFailExhausted.length > 0) {
        await admin
          .from("submissions")
          .update({
            status: "failed",
            flags: [
              {
                severity: "fail",
                message: `Validation pipeline did not start after ${MAX_AUTO_RETRY_ATTEMPTS} attempts. Please retry manually or contact support.`,
              },
            ],
          } as any)
          .in("id", idsToFailExhausted);
      }
      stuckRecoveredIds = [...idsToFail, ...idsToFailExhausted];
    }
    const stuck = stuckRecoveredIds.map((id) => ({ id }));

    // 3. Clean up expired announcements
    const { data: expiredAnnouncements } = await admin
      .from("announcements")
      .select("id")
      .lt("expires_at", nowIso);

    const expiredAnnRows = (expiredAnnouncements as any[]) || [];
    if (expiredAnnRows.length > 0) {
      const toDeleteIds = expiredAnnRows.map((r) => r.id);
      await admin.from("announcements").delete().in("id", toDeleteIds);

      try {
        const { deleteIndexed } = await import("@/lib/smart-ai/indexer");
        for (const id of toDeleteIds) {
          void deleteIndexed({ source_type: "announcement", source_id: id });
        }
      } catch (e) {
        console.error("Failed to unindex expired announcements", e);
      }
    }

    // 4. Clean up expired materials
    const { data: expiredMaterials } = await admin
      .from("materials")
      .select("id, blob_url")
      .lt("expires_at", nowIso);

    const expiredMatRows = (expiredMaterials as any[]) || [];
    if (expiredMatRows.length > 0) {
      const toDeleteIds = expiredMatRows.map((r) => r.id);

      try {
        const { del } = await import("@/lib/r2");
        for (const row of expiredMatRows) {
          if (row.blob_url) {
            await del(row.blob_url).catch((e: any) =>
              console.error("Failed to delete blob", row.blob_url, e)
            );
          }
        }
      } catch (e) {
        console.error("Failed to delete expired material blobs", e);
      }

      await admin.from("materials").delete().in("id", toDeleteIds);

      try {
        const { deleteIndexed } = await import("@/lib/smart-ai/indexer");
        for (const id of toDeleteIds) {
          void deleteIndexed({ source_type: "material", source_id: id });
        }
      } catch (e) {
        console.error("Failed to unindex expired materials", e);
      }
    }

    const result = {
      ok: true,
      missedCount,
      stuckRecovered: stuck?.length ?? 0,
      autoRetried: autoRetriedIds.length,
      expiredAnnouncementsDeleted: expiredAnnRows.length,
      expiredMaterialsDeleted: expiredMatRows.length,
    };

    console.log("[cron] mark-missed completed:", result);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[cron] mark-missed failed:", error);
    return NextResponse.json(
      { error: "Cron job failed" },
      { status: 500 }
    );
  }
}
