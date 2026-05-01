import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getReceiver } from "@/lib/qstash"
import { clearPipelineLock } from "@/lib/llm/pipeline"

/**
 * QStash failure callback. Invoked when a pipeline-stage message has
 * exhausted all retries. We mark the submission failed so it never lingers
 * in a non-terminal state — the user sees a clear retry prompt instead of
 * an indefinite "validating" spinner.
 *
 * Payload shape (per QStash docs):
 * {
 *   sourceMessageId, sourceUrl, sourceBody (base64), status, statusText,
 *   header, retried, body, // … etc.
 * }
 *
 * The original publish payload is in `sourceBody` (base64-encoded JSON).
 */
export const maxDuration = 30
export const runtime = "nodejs"

export async function POST(request: Request) {
  const raw = await request.text()

  const signature = request.headers.get("upstash-signature")
  if (!signature) {
    return NextResponse.json({ error: "missing signature" }, { status: 401 })
  }
  try {
    const receiver = getReceiver()
    const valid = await receiver.verify({ signature, body: raw })
    if (!valid) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 })
    }
  } catch (err) {
    console.error("[pipeline:failed] signature verification error", err)
    return NextResponse.json({ error: "signature verification failed" }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 })
  }

  // Decode original publish body to recover submissionId + stage.
  let submissionId: string | null = null
  let stage: string | null = null
  try {
    const obj = payload as { sourceBody?: string }
    if (obj.sourceBody) {
      const decoded = Buffer.from(obj.sourceBody, "base64").toString("utf8")
      const original = JSON.parse(decoded) as {
        submissionId?: string
        stage?: string
      }
      submissionId = original.submissionId ?? null
      stage = original.stage ?? null
    }
  } catch (err) {
    console.error("[pipeline:failed] could not decode sourceBody", err)
  }

  if (!submissionId) {
    console.error("[pipeline:failed] no submissionId in failure payload", payload)
    return NextResponse.json({ ok: true, message: "no submissionId" })
  }

  console.error(
    "[pipeline:failed] permanent failure for",
    submissionId,
    "stage:",
    stage,
    "payload:",
    payload,
  )

  const admin = createAdminClient()
  // Only update if we're still in a non-terminal state — the stage handler
  // may have written a more specific failure already.
  const { data: cur } = await admin
    .from("submissions")
    .select("status")
    .eq("id", submissionId)
    .maybeSingle()

  if (
    cur &&
    !["passed", "failed", "needs_review", "late_submitted", "missed"].includes(cur.status)
  ) {
    await admin
      .from("submissions")
      .update({
        status: "failed",
        flags: [
          {
            severity: "fail",
            message: `Validation failed permanently after retries${
              stage ? ` (stage: ${stage})` : ""
            }. Please retry manually.`,
          },
        ],
      })
      .eq("id", submissionId)
  }

  await clearPipelineLock(submissionId)

  return NextResponse.json({ ok: true })
}
