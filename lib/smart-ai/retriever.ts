import "server-only"

/**
 * RAG Retrieval – Native Supabase Implementation
 * ==============================================
 *
 * Performs vector similarity search against the `rag_documents` pgvector
 * table via Supabase RPC functions, eliminating the need for raw `pg`
 * connections or the external Python rag-service.
 *
 * Two retrieval strategies are combined via Reciprocal Rank Fusion (RRF):
 *   1. **Vector search** — cosine similarity against the query embedding
 *   2. **BM25 full-text** — tsvector/tsquery for keyword matching
 *
 * Results are then reranked by keyword overlap for precision.
 *
 * The search RPCs (`search_rag_vector`, `search_rag_bm25`) are defined in
 * `supabase/migrations/20260505_rag_documents.sql`.
 */

import { createAdminClient } from "@/lib/supabase/admin"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? ""
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "openai/text-embedding-3-small"

// Score threshold for vector search — bypassed when a specific document is targeted
const SCORE_THRESHOLD = 0.25

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
// Embedding helper
// ---------------------------------------------------------------------------

async function embedQuery(text: string): Promise<number[]> {
  if (!OPENROUTER_API_KEY) throw new Error("No embedding API key configured")

  const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: [text],
    }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`Embedding API failed (${res.status}): ${body.slice(0, 200)}`)
  }

  const json = await res.json()
  return json.data[0].embedding as number[]
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RetrieveScope {
  user_id: string
  role: string
  team_id?: string | null
}

export interface RetrievedChunk {
  id: string
  source_type: string
  source_id: string
  title: string | null
  snippet: string
  score: number
  metadata: Record<string, unknown>
}

export interface RetrieveOptions {
  scope: RetrieveScope
  query: string
  documentId?: string | null
  sourceType?: string | null
  topK?: number
}

// ---------------------------------------------------------------------------
// RRF helper
// ---------------------------------------------------------------------------

const RRF_K = 60

function reciprocalRankFusion(
  ...lists: RetrievedChunk[][]
): RetrievedChunk[] {
  const scores: Record<string, number> = {}
  const itemMap: Record<string, RetrievedChunk> = {}

  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank]
      scores[item.id] = (scores[item.id] ?? 0) + 1.0 / (RRF_K + rank + 1)
      if (!itemMap[item.id]) itemMap[item.id] = item
    }
  }

  return Object.keys(scores)
    .sort((a, b) => scores[b] - scores[a])
    .map((id) => ({ ...itemMap[id], score: scores[id] }))
}

// ---------------------------------------------------------------------------
// Keyword reranking
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
  "her", "was", "one", "our", "out", "has", "have", "from", "with",
  "they", "been", "this", "that", "each", "which", "their", "what",
  "about", "would", "there", "when", "make", "like", "will", "how",
  "show", "give", "tell", "find",
])

function rerankByKeywords(
  query: string,
  chunks: RetrievedChunk[],
  weight = 0.15,
): RetrievedChunk[] {
  if (!chunks.length || !query.trim()) return chunks

  const words = query.toLowerCase().match(/\b[a-z]{3,}\b/g) ?? []
  const keywords = words.filter((w) => !STOP_WORDS.has(w))
  if (!keywords.length) return chunks

  return chunks
    .map((chunk) => {
      const snippetLower = (chunk.snippet ?? "").toLowerCase()
      const hits = keywords.filter((kw) => snippetLower.includes(kw)).length
      const keywordScore = hits / keywords.length
      const blendedScore = (1 - weight) * chunk.score + weight * keywordScore
      return { ...chunk, score: blendedScore }
    })
    .sort((a, b) => b.score - a.score)
}

// ---------------------------------------------------------------------------
// Row parser helper
// ---------------------------------------------------------------------------

function parseRow(r: any): RetrievedChunk {
  return {
    id: String(r.id),
    source_type: r.source_type,
    source_id: r.source_id,
    title: r.title,
    snippet: r.snippet,
    score: parseFloat(r.score),
    metadata: r.metadata ?? {},
  }
}

// ---------------------------------------------------------------------------
// Main retrieve function
// ---------------------------------------------------------------------------

export async function retrieveChunks(
  opts: RetrieveOptions,
): Promise<RetrievedChunk[]> {
  if (!isSupabaseConfigured()) {
    console.warn("[rag] retrieval skipped: Supabase not configured")
    return []
  }

  if (!OPENROUTER_API_KEY) {
    console.warn("[rag] retrieval skipped: no embedding API key")
    return []
  }

  const topK = opts.topK ?? 6
  const isTargeted = !!opts.documentId
  const limitCount = topK * 3 // Fetch extra for RRF fusion headroom

  try {
    const supabase = createAdminClient()

    // 1. Embed the query
    const vector = await embedQuery(opts.query)
    const rpcParams = {
      query_embedding: `[${vector.join(",")}]`,
      match_limit: limitCount,
      filter_owner_id: opts.scope.user_id,
      filter_team_id: opts.scope.team_id ?? null,
      filter_role: opts.scope.role,
      filter_source_type: opts.sourceType ?? null,
      filter_source_id: opts.documentId ?? null,
    }

    // 3. Vector similarity search via RPC
    const { data: vecData, error: vecError } = await supabase.rpc(
      "search_rag_vector",
      rpcParams,
    )

    if (vecError) {
      console.error("[rag] vector search RPC failed:", vecError.message)
      return []
    }

    let vectorResults: RetrievedChunk[] = (vecData ?? []).map(parseRow)

    // Bypass threshold for targeted document searches
    if (!isTargeted) {
      vectorResults = vectorResults.filter((c) => c.score >= SCORE_THRESHOLD)
    }

    // 4. BM25 full-text search (best effort) via RPC
    let bm25Results: RetrievedChunk[] = []
    try {
      const bm25Params = {
        query_text: opts.query,
        match_limit: limitCount,
        filter_owner_id: opts.scope.user_id,
        filter_team_id: opts.scope.team_id ?? null,
        filter_role: opts.scope.role,
        filter_source_type: opts.sourceType ?? null,
        filter_source_id: opts.documentId ?? null,
      }

      const { data: bm25Data, error: bm25Error } = await supabase.rpc(
        "search_rag_bm25",
        bm25Params,
      )

      if (bm25Error) {
        console.warn("[rag] BM25 search RPC failed (non-fatal):", bm25Error.message)
      } else {
        bm25Results = (bm25Data ?? []).map(parseRow)
      }
    } catch (e) {
      // BM25 is best-effort
      console.warn("[rag] BM25 search failed (non-fatal):", e)
    }

    // 5. Reciprocal Rank Fusion
    let fused = bm25Results.length
      ? reciprocalRankFusion(vectorResults, bm25Results)
      : vectorResults

    // 6. Keyword reranking
    fused = rerankByKeywords(opts.query, fused)

    // 7. Deduplication — skip for targeted doc searches (we want multiple chunks)
    const seen = new Set<string>()
    const deduplicated: RetrievedChunk[] = []
    for (const chunk of fused) {
      const key = `${chunk.source_type}:${chunk.source_id}`
      if (isTargeted || !seen.has(key)) {
        seen.add(key)
        deduplicated.push(chunk)
      }
      if (deduplicated.length >= topK) break
    }

    console.log(
      `[rag] retrieve "${opts.query.slice(0, 40)}…" → ${deduplicated.length} results` +
        (isTargeted ? ` (targeted: ${opts.documentId})` : ""),
    )

    return deduplicated
  } catch (err: any) {
    console.error("[rag] retrieve failed:", err.message)
    return []
  }
}
