import "server-only"

/**
 * RAG Retrieval – Native Supabase Implementation
 * ==============================================
 *
 * Performs hybrid (vector + BM25) similarity search against the
 * `rag_documents` pgvector table via Supabase RPC functions.
 *
 *   1. Vector search   — cosine similarity (HNSW index)
 *   2. BM25 full-text  — tsvector / tsquery (GIN index)
 *
 * Results are fused via Reciprocal Rank Fusion and reranked by keyword
 * overlap. RPCs `search_rag_vector` and `search_rag_bm25` are defined in
 * `supabase/migrations/20260505_rag_documents.sql`.
 */

import { createAdminClient } from "@/lib/supabase/admin"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? ""
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? ""
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "openai/text-embedding-3-small"

// Score threshold for vector search — bypassed when a specific document is targeted
const SCORE_THRESHOLD = 0.25

// ---------------------------------------------------------------------------
// Supabase availability
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
// Embedding (mirror of indexer.ts — kept here to avoid a circular import)
// ---------------------------------------------------------------------------

function modelForProvider(provider: "openai" | "openrouter"): string {
  if (provider === "openai") return EMBEDDING_MODEL.replace(/^openai\//, "")
  return EMBEDDING_MODEL.includes("/") ? EMBEDDING_MODEL : `openai/${EMBEDDING_MODEL}`
}

async function embedQuery(text: string): Promise<number[]> {
  const provider: "openai" | "openrouter" | null = OPENAI_API_KEY
    ? "openai"
    : OPENROUTER_API_KEY
    ? "openrouter"
    : null

  if (!provider) throw new Error("no embedding API key configured")

  const url =
    provider === "openai"
      ? "https://api.openai.com/v1/embeddings"
      : "https://openrouter.ai/api/v1/embeddings"

  const apiKey = provider === "openai" ? OPENAI_API_KEY : OPENROUTER_API_KEY

  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  }
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hierarchia.app"
    headers["X-Title"] = "Hierarchia Smart AI"
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: modelForProvider(provider), input: [text] }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(
      `embedding API ${res.status} ${res.statusText}: ${body.slice(0, 200)}`,
    )
  }

  const json = (await res.json()) as { data: Array<{ embedding: number[] }> }
  if (!json?.data?.[0]?.embedding) {
    throw new Error("embedding API returned empty data")
  }
  return json.data[0].embedding
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
// RRF
// ---------------------------------------------------------------------------

const RRF_K = 60

function reciprocalRankFusion(...lists: RetrievedChunk[][]): RetrievedChunk[] {
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
// Helpers
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

function vectorToPg(vec: number[]): string {
  return `[${vec.join(",")}]`
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

  if (!OPENAI_API_KEY && !OPENROUTER_API_KEY) {
    console.warn("[rag] retrieval skipped: no embedding API key")
    return []
  }

  const topK = opts.topK ?? 6
  const isTargeted = !!opts.documentId
  const limitCount = topK * 3

  try {
    const supabase = createAdminClient()

    // 1. Embed query
    const vector = await embedQuery(opts.query)

    // pgvector RPC params accept the text-literal vector form for safety.
    const rpcParams = {
      query_embedding: `[${vector.join(",")}]`,
      match_limit: limitCount,
      filter_owner_id: opts.scope.user_id,
      filter_team_id: opts.scope.team_id ?? null,
      filter_role: opts.scope.role,
      filter_source_type: opts.sourceType ?? null,
      filter_source_id: opts.documentId ?? null,
    }

    // 2. Vector search
    const { data: vecData, error: vecError } = await supabase.rpc(
      "search_rag_vector",
      rpcParams,
    )

    if (vecError) {
      console.error("[rag] vector RPC failed:", vecError.message, vecError.details)
      return []
    }

    let vectorResults: RetrievedChunk[] = (vecData ?? []).map(parseRow)
    if (!isTargeted) {
      vectorResults = vectorResults.filter((c) => c.score >= SCORE_THRESHOLD)
    }

    // 3. BM25 (best-effort)
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
        console.warn("[rag] BM25 RPC non-fatal:", bm25Error.message)
      } else {
        bm25Results = (bm25Data ?? []).map(parseRow)
      }
    } catch (e) {
      console.warn("[rag] BM25 search failed (non-fatal):", e)
    }

    // 4. Fuse + rerank
    let fused = bm25Results.length
      ? reciprocalRankFusion(vectorResults, bm25Results)
      : vectorResults
    fused = rerankByKeywords(opts.query, fused)

    // 5. Dedup (skip for targeted document searches)
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
    console.error("[rag] retrieve failed:", err?.message ?? err)
    return []
  }
}
