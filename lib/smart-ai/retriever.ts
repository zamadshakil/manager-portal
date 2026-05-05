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
import { isDirectPgConfigured, pgQuery } from "@/lib/smart-ai/pg-client"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? ""
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? ""
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "openai/text-embedding-3-small"

// Score threshold for vector search.
//
// `text-embedding-3-small` cosine scores for *relevant* content typically
// fall in the 0.15–0.45 range — chunks containing the actual answer are
// often around 0.20–0.30 because cosine on 1536-d embeddings is naturally
// compressed. The previous 0.25 cut off legitimate matches and was the
// reason "tell me about rag in that document" returned "no mentions" even
// though the chunk was sitting in pgvector. 0.10 keeps obvious noise out
// while letting real matches through. Bypassed entirely for targeted
// (`documentId`) searches — when the caller already knows which doc to
// scope to, every chunk in that doc is fair game.
const SCORE_THRESHOLD = 0.1

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
// Direct-Postgres retrieval — preferred path
//
// Mirrors the indexer's design: when a DB connection string is configured
// we run hybrid search via the `pg` driver, bypassing PostgREST entirely.
// This avoids the schema-cache class of bugs and removes a network hop.
//
// The SQL implements the same hybrid (vector + BM25) search the RPCs
// `search_rag_vector` / `search_rag_bm25` do, with one query each, fused
// in JS via Reciprocal Rank Fusion.
// ---------------------------------------------------------------------------

interface DirectPgSearchParams {
  vector: string // pgvector text literal "[0.1,0.2,...]"
  query: string
  ownerId: string
  teamId: string | null
  role: string
  sourceType: string | null
  sourceId: string | null
  limit: number
}

async function vectorSearchDirectPg(p: DirectPgSearchParams): Promise<RetrievedChunk[]> {
  // Visibility rule mirrors the RPCs: a row is visible to the user when
  //   (1) they own it, OR
  //   (2) it has no owner and either matches their team or has no team,
  //   (3) main_admin sees everything.
  const sql = `
    SELECT
      id::text                               AS id,
      source_type,
      source_id                              AS source_id,
      title,
      LEFT(content, 800)                     AS snippet,
      (1 - (embedding <=> $1::vector))::float AS score,
      metadata
    FROM rag_documents
    WHERE
      ($6::text IS NULL OR source_type = $6)
      AND ($7::text IS NULL OR source_id = $7)
      AND (
        $5 = 'main_admin'
        OR owner_id = $3
        OR (
          owner_id IS NULL
          AND ($4::text IS NULL OR team_id = $4 OR team_id IS NULL)
        )
      )
    ORDER BY embedding <=> $1::vector ASC
    LIMIT $2
  `
  const res = await pgQuery<any>(sql, [
    p.vector,
    p.limit,
    p.ownerId,
    p.teamId,
    p.role,
    p.sourceType,
    p.sourceId,
  ])
  return res.rows.map(parseRow)
}

async function bm25SearchDirectPg(p: DirectPgSearchParams): Promise<RetrievedChunk[]> {
  // Use plainto_tsquery so user free-text never throws on tsquery syntax.
  const sql = `
    SELECT
      id::text                                         AS id,
      source_type,
      source_id                                        AS source_id,
      title,
      LEFT(content, 800)                               AS snippet,
      ts_rank(tsv, plainto_tsquery('english', $1))::float AS score,
      metadata
    FROM rag_documents
    WHERE
      tsv @@ plainto_tsquery('english', $1)
      AND ($7::text IS NULL OR source_type = $7)
      AND ($8::text IS NULL OR source_id = $8)
      AND (
        $6 = 'main_admin'
        OR owner_id = $4
        OR (
          owner_id IS NULL
          AND ($5::text IS NULL OR team_id = $5 OR team_id IS NULL)
        )
      )
    ORDER BY score DESC
    LIMIT $2
  `
  try {
    const res = await pgQuery<any>(sql, [
      p.query,
      p.limit,
      // unused, kept for parity with vector params
      null,
      p.ownerId,
      p.teamId,
      p.role,
      p.sourceType,
      p.sourceId,
    ])
    return res.rows.map(parseRow)
  } catch (err: any) {
    // BM25 is best-effort. Common failure: empty/whitespace tsquery for
    // short queries with all-stopword content. Return empty and let the
    // caller fall through to vector-only.
    console.warn("[rag] direct-pg BM25 non-fatal:", err?.message ?? err)
    return []
  }
}

// ---------------------------------------------------------------------------
// Main retrieve function
// ---------------------------------------------------------------------------

export async function retrieveChunks(
  opts: RetrieveOptions,
): Promise<RetrievedChunk[]> {
  if (!OPENAI_API_KEY && !OPENROUTER_API_KEY) {
    console.warn("[rag] retrieval skipped: no embedding API key")
    return []
  }

  const useDirectPg = isDirectPgConfigured()
  if (!useDirectPg && !isSupabaseConfigured()) {
    console.warn("[rag] retrieval skipped: neither direct-pg nor Supabase configured")
    return []
  }

  const topK = opts.topK ?? 6
  const isTargeted = !!opts.documentId
  const limitCount = topK * 3

  try {
    // 1. Embed query (works the same for both retrieval paths)
    const vector = await embedQuery(opts.query)
    const vecLiteral = vectorToPg(vector)

    let vectorResults: RetrievedChunk[] = []
    let bm25Results: RetrievedChunk[] = []

    // 2. Run hybrid search via the most reliable path available.
    if (useDirectPg) {
      const params: DirectPgSearchParams = {
        vector: vecLiteral,
        query: opts.query,
        ownerId: opts.scope.user_id,
        teamId: opts.scope.team_id ?? null,
        role: opts.scope.role,
        sourceType: opts.sourceType ?? null,
        sourceId: opts.documentId ?? null,
        limit: limitCount,
      }

      // Run both searches in parallel — they hit different indexes.
      const [vec, bm25] = await Promise.all([
        vectorSearchDirectPg(params).catch((err) => {
          console.error("[rag] direct-pg vector search failed:", err?.message ?? err)
          return [] as RetrievedChunk[]
        }),
        bm25SearchDirectPg(params),
      ])
      vectorResults = vec
      bm25Results = bm25
    } else {
      const supabase = createAdminClient()
      const rpcParams = {
        query_embedding: vecLiteral,
        match_limit: limitCount,
        filter_owner_id: opts.scope.user_id,
        filter_team_id: opts.scope.team_id ?? null,
        filter_role: opts.scope.role,
        filter_source_type: opts.sourceType ?? null,
        filter_source_id: opts.documentId ?? null,
      }

      const { data: vecData, error: vecError } = await supabase.rpc(
        "search_rag_vector",
        rpcParams,
      )
      if (vecError) {
        console.error("[rag] vector RPC failed:", vecError.message, vecError.details)
        return []
      }
      vectorResults = (vecData ?? []).map(parseRow)

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
    }

    // 3. Threshold filtering — bypassed for targeted searches.
    if (!isTargeted) {
      vectorResults = vectorResults.filter((c) => c.score >= SCORE_THRESHOLD)
    }

    // 4. Fuse + rerank
    let fused = bm25Results.length
      ? reciprocalRankFusion(vectorResults, bm25Results)
      : vectorResults
    fused = rerankByKeywords(opts.query, fused)

    // 5. Dedup (skip for targeted document searches — every chunk in the
    // doc is potentially the answer)
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

    // 6. Last-resort fallback for targeted searches that came back empty.
    //    If the user explicitly pointed us at a documentId and both
    //    vector + BM25 returned nothing (e.g. tiny corpus of one chunk
    //    with a query that is semantically far from the chunk), just
    //    return the doc's chunks ordered by chunk_index. The LLM is
    //    smart enough to summarise — far better UX than "no mentions
    //    found" when the document IS sitting right there.
    if (
      isTargeted &&
      deduplicated.length === 0 &&
      useDirectPg &&
      opts.documentId
    ) {
      try {
        const fallback = await pgQuery<any>(
          `SELECT id::text AS id, source_type, source_id AS source_id,
                  title, LEFT(content, 800) AS snippet, 0.0::float AS score, metadata
             FROM rag_documents
            WHERE source_id = $1
              AND ($2::text IS NULL OR source_type = $2)
            ORDER BY chunk_index ASC
            LIMIT $3`,
          [opts.documentId, opts.sourceType ?? null, topK],
        )
        const rows = fallback.rows.map(parseRow)
        if (rows.length > 0) {
          console.log(
            `[rag] targeted fallback: returning ${rows.length} chunks for ${opts.documentId} (hybrid search returned 0)`,
          )
          return rows
        }
      } catch (err: any) {
        console.warn("[rag] targeted fallback failed:", err?.message ?? err)
      }
    }

    console.log(
      `[rag] retrieve "${opts.query.slice(0, 40)}…" → ${deduplicated.length} results` +
        (isTargeted ? ` (targeted: ${opts.documentId})` : "") +
        ` [path: ${useDirectPg ? "direct-pg" : "rpc"}]`,
    )

    return deduplicated
  } catch (err: any) {
    console.error("[rag] retrieve failed:", err?.message ?? err)
    return []
  }
}
