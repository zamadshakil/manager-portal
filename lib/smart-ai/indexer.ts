import "server-only"

/**
 * RAG Indexing – Native Supabase Implementation
 * ==============================================
 *
 * Generates embeddings and stores document chunks directly into the
 * `rag_documents` pgvector table via the Supabase service-role client,
 * eliminating the need for raw `pg` connections or the external Python
 * rag-service.
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
 *   3. If Supabase or embedding credentials are missing, the helpers no-op
 *      silently. Smart AI just falls back to its conservative no-RAG mode.
 *
 *   4. The `rag_documents` table, pgvector extension, and tsv trigger are
 *      managed by the SQL migration `supabase/migrations/20260505_rag_documents.sql`.
 *      No dynamic DDL is executed at runtime.
 */

import { createAdminClient } from "@/lib/supabase/admin"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? ""
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small"

// Chunking
const CHUNK_SIZE = 800
const CHUNK_OVERLAP = 200

// ---------------------------------------------------------------------------
// Text chunking (pure JS, no external dependency needed)
// ---------------------------------------------------------------------------

function chunkText(text: string): string[] {
  if (!text || text.trim().length < 20) return text?.trim() ? [text.trim()] : []

  const trimmed = text.trim()
  if (trimmed.length <= CHUNK_SIZE) return [trimmed]

  const chunks: string[] = []
  const separators = ["\n\n", "\n", ". ", " "]

  function splitRecursive(content: string, sepIdx: number): string[] {
    if (content.length <= CHUNK_SIZE) return [content]
    if (sepIdx >= separators.length) {
      // Hard split at chunk_size
      const parts: string[] = []
      for (let i = 0; i < content.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
        parts.push(content.slice(i, i + CHUNK_SIZE))
      }
      return parts
    }

    const sep = separators[sepIdx]
    const segments = content.split(sep)
    const result: string[] = []
    let current = ""

    for (const seg of segments) {
      const candidate = current ? current + sep + seg : seg
      if (candidate.length > CHUNK_SIZE && current) {
        result.push(current)
        // Overlap: grab the tail of the last chunk
        const overlapStart = Math.max(0, current.length - CHUNK_OVERLAP)
        current = current.slice(overlapStart) + sep + seg
        if (current.length > CHUNK_SIZE) {
          // Still too big — recurse with next separator
          result.push(...splitRecursive(current, sepIdx + 1))
          current = ""
        }
      } else {
        current = candidate
      }
    }
    if (current.trim()) result.push(current)
    return result
  }

  chunks.push(...splitRecursive(trimmed, 0))

  // Filter trivially short chunks
  return chunks.filter((c) => c.trim().length >= 20)
}

// ---------------------------------------------------------------------------
// Embedding via OpenRouter (OpenAI-compatible API)
// ---------------------------------------------------------------------------

async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!texts.length) return []
  if (!OPENROUTER_API_KEY) throw new Error("No embedding API key configured")

  const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
    }),
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`Embedding API failed (${res.status}): ${body.slice(0, 200)}`)
  }

  const json = await res.json()
  // OpenAI-compatible response: { data: [{ embedding: [...] }] }
  return (json.data as { embedding: number[] }[])
    .sort((a: any, b: any) => a.index - b.index)
    .map((d: { embedding: number[] }) => d.embedding)
}

// ---------------------------------------------------------------------------
// Public API — Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Supabase availability check
// ---------------------------------------------------------------------------

function isSupabaseConfigured(): boolean {
  try {
    createAdminClient()
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Public API — indexDocument
// ---------------------------------------------------------------------------

/**
 * Push a single document into pgvector. Idempotent — deletes existing
 * chunks for the same (source_type, source_id), then inserts new ones.
 */
export async function indexDocument(
  input: IndexDocumentInput,
): Promise<{ ok: boolean; reason?: string }> {
  if (!isSupabaseConfigured()) {
    console.log("[rag] indexing skipped: Supabase not configured")
    return { ok: false, reason: "disabled" }
  }

  if (!OPENROUTER_API_KEY) {
    console.log("[rag] indexing skipped: no embedding API key")
    return { ok: false, reason: "disabled" }
  }

  // Optional kill-switch — set RAG_INDEX_DISABLED_TYPES="task,submission" in
  // the env to skip specific source kinds during incident triage without
  // redeploying. Default: index everything.
  const disabled = (process.env.RAG_INDEX_DISABLED_TYPES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  if (disabled.includes(input.source_type)) {
    console.log(`[rag] indexing skipped: ${input.source_type} is disabled via env`)
    return { ok: false, reason: "disabled" }
  }

  // Empty / whitespace-only content provides no retrieval value.
  if (!input.content || input.content.trim().length < 16) {
    return { ok: false, reason: "skipped: content too short" }
  }

  try {
    const supabase = createAdminClient()

    // 1. Chunk the text
    const chunks = chunkText(input.content)
    if (!chunks.length) return { ok: false, reason: "no chunks produced" }

    console.log(`[rag] indexing ${input.source_type}:${input.source_id} → ${chunks.length} chunks`)

    // 2. Generate embeddings for all chunks in one API call
    const vectors = await embedTexts(chunks)

    // 3. Delete existing chunks for this source (re-index / idempotent)
    const { error: deleteError } = await supabase
      .from("rag_documents")
      .delete()
      .eq("source_type", input.source_type)
      .eq("source_id", input.source_id)

    if (deleteError) {
      console.warn("[rag] delete old chunks warning:", deleteError.message)
      // Non-fatal — table might be empty or row might not exist
    }

    // 4. Build all rows and insert via Supabase
    const rows = chunks.map((chunk, i) => ({
      source_type: input.source_type,
      source_id: input.source_id,
      chunk_index: i,
      team_id: input.team_id ?? null,
      owner_id: input.owner_id ?? null,
      title: input.title ?? null,
      content: chunk,
      // Supabase pgvector accepts the array string format for vector columns
      embedding: `[${vectors[i].join(",")}]`,
      metadata: {
        ...(input.metadata ?? {}),
        chunk_index: i,
        total_chunks: chunks.length,
      },
      // `tsv` is auto-populated by the database trigger
    }))

    const { error: insertError } = await supabase
      .from("rag_documents")
      .insert(rows)

    if (insertError) {
      throw new Error(`Insert failed: ${insertError.message}`)
    }

    console.log(`[rag] indexed ${input.source_type}:${input.source_id} ✓ (${chunks.length} chunks)`)
    return { ok: true }
  } catch (err: any) {
    console.error(`[rag] index ${input.source_type}:${input.source_id} failed:`, err.message)
    return { ok: false, reason: err.message ?? "indexing error" }
  }
}

// ---------------------------------------------------------------------------
// Public API — deleteIndexed
// ---------------------------------------------------------------------------

/**
 * Remove a document from the index. Called from the matching delete actions.
 * Best-effort: if it fails the row is just stale until the next reindex job.
 */
export async function deleteIndexed(args: {
  source_type: IndexSourceType
  source_id: string
}): Promise<void> {
  if (!isSupabaseConfigured()) return

  try {
    const supabase = createAdminClient()
    await supabase
      .from("rag_documents")
      .delete()
      .eq("source_type", args.source_type)
      .eq("source_id", args.source_id)
  } catch (err) {
    console.warn(`[rag] delete ${args.source_type}:${args.source_id} threw`, err)
  }
}

// ---------------------------------------------------------------------------
// Public API — joinContent
// ---------------------------------------------------------------------------

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
