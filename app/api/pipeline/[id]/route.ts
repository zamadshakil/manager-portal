import { NextResponse, after } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { inngest } from "@/lib/inngest/client"

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

  let admin;
  try {
    admin = createAdminClient()
  } catch (err: any) {
    return NextResponse.json({ error: "Admin client init failed", details: err.message }, { status: 500 })
  }

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

  try {
    // Only process if the submission is in a processable state.
    if (!["queued", "parsing", "validating"].includes(sub.status)) {
      return NextResponse.json({
        ok: true,
        status: sub.status,
        message: "Submission already processed.",
      })
    }

    // Trigger the background job via Inngest.
    // This bypasses the Vercel 60s timeout entirely because Inngest orchestrates
    // the execution across multiple serverless invocations and handles retries.
    await inngest.send({
      name: "app/submission.process",
      data: { submissionId },
    })

    // Return immediately so the client can begin polling.
    return NextResponse.json({
      ok: true,
      status: sub.status,
      queued: true,
    })
  } catch (error: any) {
    console.error("Pipeline trigger error:", error)
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message || String(error) },
      { status: 500 }
    )
  }
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
