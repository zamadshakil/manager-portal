import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
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
      expiredAnnouncementsDeleted: expiredAnnRows.length,
      expiredMaterialsDeleted: expiredMatRows.length,
    };

    // Optional: record execution in Redis for monitoring
    try {
      const { recordTaskExecution } = await import("@/lib/upstash-scheduler");
      await recordTaskExecution("mark-missed", result);
    } catch (e) {
      console.error("Failed to record task execution", e);
    }

    console.log("[cron] mark-missed completed:", result);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[cron] mark-missed failed:", error);
    return NextResponse.json(
      { error: "Cron job failed", details: error.message },
      { status: 500 }
    );
  }
}
