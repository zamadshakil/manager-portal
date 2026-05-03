import "server-only"

/**
 * RAG indexing helpers.
 *
 * The portal pushes content into the FastAPI rag-service whenever a manager
 * or member creates / updates / deletes a piece of knowledge that Smart AI
 * should be able to retrieve later (announcements, materials, tasks,
 * submission summaries, validation outcomes, …).
 *
 * Design rules:
 *
 *   1. Indexing is **best-effort, fire-and-forget**. A failure here must
 *      never break the user-facing server action — content was already
 *      persisted to Supabase by the time we're called. We log and move on.
 *
 *   2. We never block the action's response on the index call. The helpers
 *      return Promises that the caller can `await` if it wants confirmation,
 *      but the recommended usage is `void indexDocument({...})` so the user
 *      sees an immediate redirect / revalidation.
 *
 *   3. If `RAG_SERVICE_URL` / `RAG_SERVICE_TOKEN` are not configured (e.g.
 *      during the first day of the Railway rollout), the helpers no-op
 *      silently. Smart AI just falls back to its conservative no-RAG mode.
 *
 *   4. The shape on the wire matches `IndexRequest` in
 *      `rag-service/main.py`. Keep them in sync.
 */

const RAG_URL = (process.env.RAG_SERVICE_URL ?? "").replace(/\/$/, "")
const RAG_TOKEN = process.env.RAG_SERVICE_TOKEN ?? ""

function isConfigured(): boolean {
  return Boolean(RAG_URL && RAG_TOKEN)
}

/** Sources we currently index. Add new kinds here as the surface grows. */
export type IndexSourceType =
  | "announcement"
  | "material"
  | "task"
  | "submission"
  | "validation_run"
  | "rule"
  | "chat_attachment"

export interface IndexDocumentInput {
  source_type: IndexSourceType
  source_id: string
  team_id?: string | null
  owner_id?: string | null
  title?: string | null
  /**
   * Free-form text the embedding model will see. The caller is responsible
   * for joining title + body / description / instructions — we keep this
   * helper dumb and let each call site decide what's relevant.
   */
  content: string
  metadata?: Record<string, unknown>
}

/**
 * Push a single document into pgvector via the rag-service. Idempotent —
 * the rag-service upserts on (source_type, source_id), so calling this on
 * every create *and* every update is the correct pattern.
 */
export async function indexDocument(input: IndexDocumentInput): Promise<void> {
  if (!isConfigured()) return

  // Optional kill-switch — set RAG_INDEX_DISABLED_TYPES="task,submission" in
  // the env to skip specific source kinds during incident triage without
  // redeploying. Default: index everything.
  const disabled = (process.env.RAG_INDEX_DISABLED_TYPES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  if (disabled.includes(input.source_type)) return

  // Empty / whitespace-only content provides no retrieval value and would
  // waste an embedding call. Bumped from 4 → 16 so a single-word title
  // doesn't slip in as a useless "document".
  if (!input.content || input.content.trim().length < 16) return

  try {
    const res = await fetch(`${RAG_URL}/v1/index`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${RAG_TOKEN}`,
      },
      body: JSON.stringify({
        source_type: input.source_type,
        source_id: input.source_id,
        team_id: input.team_id ?? null,
        owner_id: input.owner_id ?? null,
        title: input.title ?? null,
        content: input.content,
        metadata: input.metadata ?? {},
      }),
      cache: "no-store",
      // Hard cap so a hung rag-service can't pin a Railway function.
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      console.warn(
        `[rag] index ${input.source_type}:${input.source_id} failed (${res.status}): ${body.slice(0, 200)}`,
      )
    }
  } catch (err) {
    console.warn(`[rag] index ${input.source_type}:${input.source_id} threw`, err)
  }
}

/**
 * Remove a document from the index. Called from the matching delete actions.
 * Best-effort: if it fails the row is just stale until the next reindex job.
 */
export async function deleteIndexed(args: {
  source_type: IndexSourceType
  source_id: string
}): Promise<void> {
  if (!isConfigured()) return
  try {
    const url = new URL(`${RAG_URL}/v1/index`)
    url.searchParams.set("source_type", args.source_type)
    url.searchParams.set("source_id", args.source_id)
    const res = await fetch(url, {
      method: "DELETE",
      headers: { authorization: `Bearer ${RAG_TOKEN}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok && res.status !== 404) {
      console.warn(`[rag] delete ${args.source_type}:${args.source_id} failed (${res.status})`)
    }
  } catch (err) {
    console.warn(`[rag] delete ${args.source_type}:${args.source_id} threw`, err)
  }
}

/**
 * Convenience: build the `content` string from typical fields. Keeps call
 * sites tidy and ensures we don't send `null` strings to the embedder.
 */
export function joinContent(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (p ?? "").trim())
    .filter((p) => p.length > 0)
    .join("\n\n")
}
