import { NextResponse, after } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { enqueueSubmission } from "@/lib/llm/pipeline"

/**
 * Trigger endpoint for the AI validation pipeline. We enqueue the first
 * stage to QStash (or fall back to inline execution in dev) and return
 * immediately so the client can begin polling for status updates.
 *
 * The actual pipeline work runs in `/api/pipeline/run` — one function
 * invocation per stage, each with its own 60s budget.
 */
export const maxDuration = 30

/**
 * POST /api/pipeline/[id]
 *
 * Triggers the AI validation pipeline for a submission. Called by the
 * client immediately after a successful upload or retry. The pipeline's
 * own Redis idempotency lock prevents double-runs from concurrent callers.
 *
 * Auth: requires an authenticated Supabase session. The caller must be
 * the uploader, a manager of the same team, or a main_admin.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: submissionId } = await params

  // Validate session.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Verify submission exists and caller has access.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, team_id")
    .eq("id", user.id)
    .single()
  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data: sub } = await admin
    .from("submissions")
    .select("id, team_id, uploader_id, status")
    .eq("id", submissionId)
    .single()
  if (!sub) {
    return NextResponse.json({ error: "Submission not found" }, { status: 404 })
  }

  // Authorization: uploader, team manager, or main_admin.
  const authorized =
    profile.role === "main_admin" ||
    profile.id === sub.uploader_id ||
    (profile.role === "manager" && profile.team_id === sub.team_id)
  if (!authorized) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 })
  }

  // Only process if the submission is in a processable state.
  if (!["queued", "parsing", "validating"].includes(sub.status)) {
    return NextResponse.json({
      ok: true,
      status: sub.status,
      message: "Submission already processed.",
    })
  }

  // Enqueue the first pipeline stage. With QStash configured this returns
  // in ~50ms; without it we fall back to inline `after()` execution.
  // We still wrap in after() so the HTTP response goes out immediately
  // even if QStash publish takes a moment.
  after(async () => {
    try {
      await enqueueSubmission(submissionId)
    } catch (err) {
      console.error("[pipeline-route] enqueue error", submissionId, err)
    }
  })

  // Return immediately so the client can begin polling.
  return NextResponse.json({
    ok: true,
    status: sub.status,
    queued: true,
  })
}

/**
 * GET /api/pipeline/[id]
 *
 * Lightweight status check for client-side polling. Returns the current
 * submission status without triggering any processing.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: submissionId } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Use the user-scoped client so RLS applies.
  const { data: sub } = await supabase
    .from("submissions")
    .select("id, status, score, summary, flags")
    .eq("id", submissionId)
    .single()

  if (!sub) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const terminal = ["passed", "failed", "needs_review", "late_submitted", "missed"].includes(
    sub.status,
  )

  return NextResponse.json({
    status: sub.status,
    score: sub.score,
    summary: sub.summary,
    flags: sub.flags,
    terminal,
  })
}
