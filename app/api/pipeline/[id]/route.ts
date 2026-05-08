import { NextResponse } from "next/server"
// @ts-ignore
import { unstable_after as after } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { processSubmission } from "@/lib/llm/pipeline"

/**
 * This route owns the AI pipeline lifecycle — parsing, LLM validation,
 * scoring — completely decoupled from the upload Server Action so the
 * upload stays fast (~2s) and the pipeline runs asynchronously in the
 * background within the same Railway process.
 */
export const maxDuration = 60

/**
 * POST /api/pipeline/[id]
 *
 * Triggers the AI validation pipeline for a submission. Called by the
 * client immediately after a successful upload or retry. The pipeline
 * runs as a fire-and-forget async function in the Node process.
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
    console.error("[pipeline] admin client init failed:", err.message)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
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

  // Only process if the submission is in a processable state.
  if (!["queued", "parsing", "validating"].includes(sub.status)) {
    return NextResponse.json({
      ok: true,
      status: sub.status,
      message: "Submission already processed.",
    })
  }

  // Fire-and-forget using Next.js after() to ensure background execution isn't killed
  // by the serverless runtime.
  if (typeof after === 'function') {
    after(() => {
      processSubmission(submissionId).catch((err) => {
        console.error("[pipeline] background crash for", submissionId, err)
      })
    })
  } else {
    // Fallback if after is not available (e.g. Next.js 14 non-experimental)
    processSubmission(submissionId).catch((err) => {
      console.error("[pipeline] background crash for", submissionId, err)
    })
  }

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
