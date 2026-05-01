import "server-only"
import { Client, Receiver } from "@upstash/qstash"

/**
 * QStash is the durable message queue we use to chain pipeline stages.
 * Each stage runs in its own serverless function invocation with its own
 * 60s budget — so a 30-rule submission is no longer constrained to a single
 * function's runtime ceiling.
 *
 * Architecture:
 *   trigger route → enqueue("parse")
 *     → /api/pipeline/run (parse stage) → enqueue("rules:0")
 *       → /api/pipeline/run (rules batch 0) → enqueue("rules:1") or "finalize"
 *         → … → /api/pipeline/run (finalize) → done
 *
 * If QSTASH_TOKEN is not configured, we fall back to running stages inline
 * via `after()` so local dev (and emergency hot-fix deploys) still work.
 *
 * Required env vars in production:
 *   QSTASH_TOKEN
 *   QSTASH_CURRENT_SIGNING_KEY
 *   QSTASH_NEXT_SIGNING_KEY
 *   APP_URL or NEXT_PUBLIC_SITE_URL or VERCEL_URL — public URL of the app
 */

let _client: Client | null = null
function getClient(): Client {
  if (_client) return _client
  const token = process.env.QSTASH_TOKEN
  if (!token) throw new Error("QSTASH_TOKEN is not set")
  _client = new Client({ token })
  return _client
}

let _receiver: Receiver | null = null
export function getReceiver(): Receiver {
  if (_receiver) return _receiver
  const cur = process.env.QSTASH_CURRENT_SIGNING_KEY
  const nxt = process.env.QSTASH_NEXT_SIGNING_KEY
  if (!cur || !nxt) {
    throw new Error("QSTASH_CURRENT_SIGNING_KEY and QSTASH_NEXT_SIGNING_KEY must be set")
  }
  _receiver = new Receiver({ currentSigningKey: cur, nextSigningKey: nxt })
  return _receiver
}

/**
 * Resolve the public base URL of this app so QStash can call back into us.
 * Order of preference:
 *   1. APP_URL (explicit override — set this in production)
 *   2. NEXT_PUBLIC_SITE_URL
 *   3. VERCEL_URL (automatic on Vercel — works for preview deploys)
 */
export function getAppUrl(): string | null {
  const explicit = process.env.APP_URL || process.env.NEXT_PUBLIC_SITE_URL
  if (explicit) return explicit.replace(/\/$/, "")
  const vercel = process.env.VERCEL_URL
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`
  return null
}

export function isQStashConfigured(): boolean {
  return Boolean(process.env.QSTASH_TOKEN && getAppUrl())
}

/**
 * Pipeline-stage message payload. `attemptId` is a fresh nonce generated
 * by `enqueueSubmission` for each pipeline attempt, then threaded through
 * every stage so the dedup ID is unique per-attempt (QStash stores dedup
 * IDs for 90 days — without the nonce, retries would silently no-op).
 *
 * Stages also use `attemptId` to fence out stale work from a previous
 * attempt that may still be in flight when a user retries.
 */
export interface StagePayload {
  submissionId: string
  stage: string
  attemptId: string
}

/**
 * Publish a single pipeline-stage message. Returns the QStash message id
 * on success, or null when QStash is not configured (caller will fall back).
 *
 * The dedup ID is `${submissionId}:${attemptId}:${stage}` — unique per
 * attempt so retries never collide, but stable within an attempt so QStash
 * delivery retries don't double-run a stage.
 *
 * `failureCallback` is invoked by QStash when ALL retries are exhausted,
 * so the submission row never lingers in a non-terminal state.
 */
export async function publishStage(opts: StagePayload): Promise<string | null> {
  if (!isQStashConfigured()) return null
  const appUrl = getAppUrl()!
  const client = getClient()
  const res = await client.publishJSON({
    url: `${appUrl}/api/pipeline/run`,
    body: {
      submissionId: opts.submissionId,
      stage: opts.stage,
      attemptId: opts.attemptId,
    } satisfies StagePayload,
    deduplicationId: `${opts.submissionId}:${opts.attemptId}:${opts.stage}`,
    retries: 3,
    failureCallback: `${appUrl}/api/pipeline/failed`,
  })
  return res.messageId
}
