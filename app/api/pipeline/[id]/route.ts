import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { processSubmission } from "@/lib/llm/pipeline"

/**
 * Vercel Hobby plan allows up to 60s per serverless function. This route
 * owns the full AI pipeline lifecycle — parsing, LLM validation, scoring —
 * completely decoupled from the upload Server Action so the upload stays
 * fast (~2s) and the pipeline gets a dedicated 60s budget.
 */
export const maxDuration = 60

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

  // Run the pipeline synchronously in this function's 60s budget.
  try {
    await processSubmission(submissionId)
  } catch (err) {
    console.error("[pipeline-route] pipeline error", submissionId, err)
    // The pipeline itself handles status updates on failure, so we just
    // acknowledge the error here.
  }

  // Fetch the final status to return to the caller.
  const { data: result } = await admin
    .from("submissions")
    .select("status, score, summary")
    .eq("id", submissionId)
    .single()

  return NextResponse.json({
    ok: true,
    status: result?.status ?? "unknown",
    score: result?.score,
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
