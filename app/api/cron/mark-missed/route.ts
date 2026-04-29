import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  shouldRunCronTask,
  recordTaskExecution,
} from "@/lib/upstash-scheduler"

/**
 * Cron entrypoint for marking missed task assignments.
 *
 * SCHEDULING: Uses Upstash Redis to maintain 15-minute intervals.
 * Since Vercel allows only ONE daily cron job, this route is called
 * by the daily Vercel cron, but only executes every 15 minutes via
 * Upstash-based rate limiting.
 *
 * Behavior:
 *   1. Find every `task_assignment` whose status is still 'assigned' but whose
 *      parent task's `due_at` has passed.
 *   2. If the task forbids late submissions (`allow_late = false`) we mark
 *      the assignment as `missed` immediately. Otherwise we leave it alone
 *      so members can still submit late with a reason.
 *   3. We also auto-fail any submissions stuck in `queued`/`parsing`/
 *      `validating` for over 30 minutes — those signal a crashed pipeline.
 *
 * Auth: protected by the `CRON_SECRET` header that Vercel Cron sets, plus a
 * fallback bearer check so curl / staging triggers still work.
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization")
  const expected = process.env.CRON_SECRET
  if (expected && auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  // Check if 15 minutes have passed since last execution
  // This allows Vercel to call us daily while we execute every 15 minutes
  const shouldRun = await shouldRunCronTask()
  if (!shouldRun) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      message: "Execution skipped - waiting for 15-minute interval",
    })
  }

  const admin = createAdminClient()
  const nowIso = new Date().toISOString()

  try {
    // 1. Mark missed assignments for tasks that forbid lateness.
    const { data: overdue } = await admin
      .from("task_assignments")
      .select("id, task:tasks!inner(id, due_at, allow_late)")
      .eq("status", "assigned")
      .not("task.due_at", "is", null)
      .lt("task.due_at", nowIso)

    let missedCount = 0
    const overdueRows = (overdue as unknown as any[]) || []
    if (overdueRows.length > 0) {
      const toMiss = overdueRows
        .filter((row) => row.task.allow_late === false)
        .map((row) => row.id)

      if (toMiss.length > 0) {
        await admin
          .from("task_assignments")
          .update({ status: "missed" })
          .in("id", toMiss)
        missedCount = toMiss.length
      }
    }

    // 2. Auto-fail stuck submissions (pipeline crash recovery).
    const stuckCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()
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
      })
      .in("status", ["queued", "parsing", "validating"])
      .lt("updated_at", stuckCutoff)
      .select("id")

    const result = {
      ok: true,
      missedCount,
      stuckRecovered: stuck?.length ?? 0,
    }

    // Record execution in Upstash for monitoring
    await recordTaskExecution("mark-missed", result)

    return NextResponse.json(result)
  } catch (error) {
    console.error("[Cron] mark-missed error:", error)

    await recordTaskExecution("mark-missed", {
      ok: false,
      error: String(error),
    })

    return NextResponse.json(
      { ok: false, error: String(error) },
      { status: 500 }
    )
  }
}
