import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Cron entrypoint. Schedule via vercel.json:
 *   { "crons": [{ "path": "/api/cron/mark-missed", "schedule": "*\/15 * * * *" }] }
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

  const admin = createAdminClient()
  const nowIso = new Date().toISOString()

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

  return NextResponse.json({
    ok: true,
    missedCount,
    stuckRecovered: stuck?.length ?? 0,
  })
}
