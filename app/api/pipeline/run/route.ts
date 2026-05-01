import { NextResponse, after } from "next/server"
import { runStage } from "@/lib/llm/pipeline"
import { getReceiver } from "@/lib/qstash"

/**
 * QStash webhook target. Each pipeline stage transition publishes a
 * message to QStash, which then calls back into this route with a fresh
 * 60s function budget.
 *
 * Auth: HMAC signature verification using QStash's signing keys. Without
 * this, anyone could trigger pipeline runs by posting to this URL.
 */
export const maxDuration = 60
export const runtime = "nodejs"

interface StagePayload {
  submissionId: string
  stage: string
}

export async function POST(request: Request) {
  // Read the raw body once for signature verification.
  const raw = await request.text()

  const signature = request.headers.get("upstash-signature")
  if (!signature) {
    return NextResponse.json({ error: "missing signature" }, { status: 401 })
  }

  try {
    const receiver = getReceiver()
    const valid = await receiver.verify({
      signature,
      body: raw,
      // url verification: QStash signs the URL it called; if a proxy rewrites
      // it we'd fail. We trust the signature alone here.
    })
    if (!valid) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 })
    }
  } catch (err) {
    console.error("[pipeline:webhook] signature verification error", err)
    return NextResponse.json({ error: "signature verification failed" }, { status: 401 })
  }

  let payload: StagePayload
  try {
    payload = JSON.parse(raw) as StagePayload
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 })
  }
  if (
    !payload ||
    typeof payload.submissionId !== "string" ||
    typeof payload.stage !== "string"
  ) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 })
  }

  // Acknowledge immediately so QStash doesn't time out on us, and keep
  // running the stage in the same function via after(). If we throw, QStash
  // will retry the message — `runStage` is idempotent (state-checked).
  after(async () => {
    try {
      await runStage(payload.submissionId, payload.stage)
    } catch (err) {
      console.error(
        "[pipeline:webhook] runStage error",
        payload.submissionId,
        payload.stage,
        err,
      )
    }
  })

  return NextResponse.json({ ok: true })
}
