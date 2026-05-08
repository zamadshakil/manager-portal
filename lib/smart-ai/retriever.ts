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
import { isRerankerConfigured, crossEncoderRerank } from "@/lib/smart-ai/reranker"

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

async function embedQueryOnce(
  text: string,
  provider: "openai" | "openrouter",
  apiKey: string,
): Promise<number[]> {
  const url =
    provider === "openai"
      ? "https://api.openai.com/v1/embeddings"
      : "https://openrouter.ai/api/v1/embeddings"

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
    const err: any = new Error(
      `embedding API ${res.status} ${res.statusText}: ${body.slice(0, 200)}`,
    )
    err.status = res.status
    err.transient = res.status >= 500 || res.status === 408 || res.status === 429
    throw err
  }

  const json = (await res.json()) as { data: Array<{ embedding: number[] }> }
  if (!json?.data?.[0]?.embedding) {
    throw new Error("embedding API returned empty data")
  }
  return json.data[0].embedding
}

/**
 * Embed a query with one automatic retry on transient failures (5xx, 408,
 * 429, network errors, timeouts). Permanent errors (4xx auth/validation)
 * fail fast so we don't waste latency.
 */
async function embedQuery(text: string): Promise<number[]> {
  const provider: "openai" | "openrouter" | null = OPENAI_API_KEY
    ? "openai"
    : OPENROUTER_API_KEY
    ? "openrouter"
    : null

  if (!provider) throw new Error("no embedding API key configured")
  const apiKey = provider === "openai" ? OPENAI_API_KEY : OPENROUTER_API_KEY

  const ATTEMPTS = 2
  let lastErr: unknown
  for (let i = 0; i < ATTEMPTS; i++) {
    try {
      return await embedQueryOnce(text, provider, apiKey)
    } catch (err: any) {
      lastErr = err
      const isLast = i === ATTEMPTS - 1
      const transient =
        err?.transient === true ||
        err?.name === "AbortError" ||
        err?.name === "TimeoutError" ||
        /fetch failed|network|econn|timeout|timed out/i.test(err?.message ?? "")
      if (isLast || !transient) throw err
      const delay = 250 * (i + 1)
      console.warn(
        `[rag] embedQuery attempt ${i + 1}/${ATTEMPTS} failed (transient), retrying in ${delay}ms:`,
        err?.message ?? err,
      )
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw lastErr
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
  /**
   * Capability-aware allowlist of `source_type` values the caller is
   * permitted to retrieve. When provided, both the SQL filter and the
   * post-retrieval safety net drop chunks whose source_type is not in
   * this list. Pass `null` / omit to skip filtering (legacy behaviour).
   *
   * The chat route computes this from the user's effective capabilities
   * via `aiAllowedRagSourceTypes`, so unauthorised modules never reach
   * the LLM context window — the #1 RAG-leakage defence.
   */
  allowedSourceTypes?: string[] | null
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
  /**
   * Optional capability allowlist. When non-null, rows whose `source_type`
   * is not in this array are filtered at the SQL level. The post-retrieval
   * filter in `retrieveChunks` is the second line of defence.
   */
  allowedSourceTypes: string[] | null
}

async function vectorSearchDirectPg(p: DirectPgSearchParams): Promise<RetrievedChunk[]> {
  // Visibility rule mirrors the RPCs: a row is visible to the user when
  //   (1) they own it, OR
  //   (2) it has no owner and either matches their team or has no team,
  //   (3) main_admin sees everything.
  // PLUS (when supplied) the row's source_type must be in the capability
  // allowlist — this is what blocks "AI sees validation rules even though
  // the member can't read them in the UI".
  const sql = `
    SELECT
      id::text                               AS id,
      source_type,
      source_id                              AS source_id,
      title,
      LEFT(content, 1500)                    AS snippet,
      (1 - (embedding <=> $1::vector))::float AS score,
      metadata
    FROM rag_documents
    WHERE
      ($6::text IS NULL OR source_type = $6)
      AND ($7::text IS NULL OR source_id = $7)
      AND ($8::text[] IS NULL OR source_type = ANY($8::text[]))
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
    p.allowedSourceTypes,
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
      LEFT(content, 1500)                              AS snippet,
      ts_rank(tsv, plainto_tsquery('english', $1))::float AS score,
      metadata
    FROM rag_documents
    WHERE
      tsv @@ plainto_tsquery('english', $1)
      AND ($7::text IS NULL OR source_type = $7)
      AND ($8::text IS NULL OR source_id = $8)
      AND ($9::text[] IS NULL OR source_type = ANY($9::text[]))
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
      p.allowedSourceTypes,
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

  const isTargeted = !!opts.documentId
  // For targeted searches we want ALL chunks from the document so the LLM
  // has full context. For corpus-wide searches we keep it tighter.
  const topK = isTargeted ? Math.max(opts.topK ?? 20, 20) : (opts.topK ?? 8)
  const limitCount = isTargeted ? 100 : topK * 3

  try {
    // 1. Embed query (works the same for both retrieval paths)
    const vector = await embedQuery(opts.query)
    const vecLiteral = vectorToPg(vector)

    let vectorResults: RetrievedChunk[] = []
    let bm25Results: RetrievedChunk[] = []

    // 2. Run hybrid search via the most reliable path available.
    // Normalise the capability allowlist: empty array means "no source types
    // allowed at all" (we still let chat_attachment + targeted document IDs
    // pass the post-retrieval filter below).
    const allowedSourceTypes =
      opts.allowedSourceTypes && opts.allowedSourceTypes.length > 0
        ? opts.allowedSourceTypes
        : opts.allowedSourceTypes === undefined || opts.allowedSourceTypes === null
        ? null
        : []

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
        allowedSourceTypes,
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

    // 2b. Capability allowlist safety net.
    //
    // Even though we already pass the allowlist into the SQL of the
    // direct-pg path, we also enforce it in JS here so the RPC path
    // and any future retrieval surface inherits the same guarantee.
    // `chat_attachment` and targeted document searches (where the user
    // already proved access by uploading / specifying the source) are
    // exempt — those are owner-scoped at the row level.
    if (allowedSourceTypes !== null) {
      const allow = new Set(allowedSourceTypes)
      const sourceIdAllow = opts.documentId
      const filterFn = (c: RetrievedChunk) =>
        c.source_type === "chat_attachment" ||
        (sourceIdAllow != null && c.source_id === sourceIdAllow) ||
        allow.has(c.source_type)
      vectorResults = vectorResults.filter(filterFn)
      bm25Results = bm25Results.filter(filterFn)
    }

    // 3. Threshold filtering — bypassed for targeted searches.
    if (!isTargeted) {
      vectorResults = vectorResults.filter((c) => c.score >= SCORE_THRESHOLD)
    }

    // 4. Fuse + keyword rerank
    let fused = bm25Results.length
      ? reciprocalRankFusion(vectorResults, bm25Results)
      : vectorResults
    fused = rerankByKeywords(opts.query, fused)

    // 4b. Cross-encoder reranking (Jina Reranker v2)
    //     This is the highest-impact accuracy improvement: a cross-encoder
    //     sees BOTH the query and each chunk together, producing much more
    //     accurate relevance scores than bi-encoder (vector) similarity.
    //     Only fires when JINA_API_KEY is configured. Falls back gracefully.
    if (isRerankerConfigured() && fused.length >= 2) {
      const docs = fused.map((c) => ({
        id: c.id,
        text: c.snippet,
      }))
      const reranked = await crossEncoderRerank(opts.query, docs)
      // Rebuild fused array in the cross-encoder's preferred order,
      // and update scores to reflect cross-encoder relevance.
      const idToChunk = new Map(fused.map((c) => [c.id, c]))
      fused = reranked
        .map((r) => {
          const chunk = idToChunk.get(r.id)
          if (!chunk) return null
          return { ...chunk, score: r.score }
        })
        .filter(Boolean) as typeof fused
    }

    // 5. Dedup — for targeted doc searches we keep EVERY chunk from the
    //    document (they all share the same source_id). For corpus-wide
    //    searches we dedup by source so the user sees variety.
    let deduplicated: RetrievedChunk[]
    if (isTargeted) {
      // Keep all chunks, just cap at topK.
      deduplicated = fused.slice(0, topK)
    } else {
      const seen = new Set<string>()
      deduplicated = []
      for (const chunk of fused) {
        const key = `${chunk.source_type}:${chunk.source_id}`
        if (!seen.has(key)) {
          seen.add(key)
          deduplicated.push(chunk)
        }
        if (deduplicated.length >= topK) break
      }
    }

    // 6. Contextual window: for each matched chunk, also fetch the
    //    adjacent chunks (chunk_index ± 1) from the same document.
    //    This reconstructs information that spans chunk boundaries.
    if (useDirectPg && deduplicated.length > 0 && deduplicated.length <= 30) {
      deduplicated = await expandContextWindow(deduplicated, topK)
    }

    // 7. Last-resort fallback for targeted searches that came back empty.
    //    Return ALL chunks from the document ordered by chunk_index so the
    //    LLM can summarise the whole thing.
    if (
      isTargeted &&
      deduplicated.length === 0 &&
      useDirectPg &&
      opts.documentId
    ) {
      try {
        const fallback = await pgQuery<any>(
          `SELECT id::text AS id, source_type, source_id AS source_id,
                  title, content AS snippet, 0.0::float AS score, metadata
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
    // Re-throw hard failures so the caller (the searchDocument tool in the
    // chat route) can distinguish "no matches" from "retrieval system
    // failed" and tell the user accordingly. Previously we swallowed the
    // error and returned [], which caused the model to confidently tell
    // users "no relevant content found" when the embedding API or
    // pgvector was actually down.
    console.error("[rag] retrieve failed:", err?.message ?? err)
    const wrapped: any = new Error(`retrieve failed: ${err?.message ?? String(err)}`)
    wrapped.cause = err
    throw wrapped
  }
}

// ---------------------------------------------------------------------------
// Contextual window expansion
//
// For each retrieved chunk, fetch the chunks immediately before and after it
// (by chunk_index) from the same document. This reconstructs information
// that the chunker split across boundaries — the #1 cause of "I can see the
// document has a timeline section but the retriever didn't return it."
// ---------------------------------------------------------------------------

async function expandContextWindow(
  chunks: RetrievedChunk[],
  maxTotal: number,
): Promise<RetrievedChunk[]> {
  const needed = new Map<string, Set<number>>()
  const existingIds = new Set(chunks.map((c) => c.id))

  for (const c of chunks) {
    const ci = typeof c.metadata?.chunk_index === "number" ? c.metadata.chunk_index : -1
    if (ci < 0) continue
    const key = c.source_id
    if (!needed.has(key)) needed.set(key, new Set())
    const set = needed.get(key)!
    if (ci > 0) set.add(ci - 1)
    set.add(ci)
    set.add(ci + 1)
  }

  if (needed.size === 0) return chunks

  const conditions: string[] = []
  const params: unknown[] = []
  let p = 1
  for (const [sourceId, indexes] of needed) {
    const idxArray = Array.from(indexes)
    conditions.push(`(source_id = $${p++} AND chunk_index = ANY($${p++}::int[]))`)
    params.push(sourceId, idxArray)
  }

  try {
    const res = await pgQuery<any>(
      `SELECT id::text AS id, source_type, source_id AS source_id,
              title, content AS snippet, 0.0::float AS score, metadata
         FROM rag_documents
        WHERE ${conditions.join(" OR ")}
        ORDER BY source_id, chunk_index ASC`,
      params,
    )

    const merged = [...chunks]
    for (const row of res.rows) {
      const parsed = parseRow(row)
      if (!existingIds.has(parsed.id)) {
        existingIds.add(parsed.id)
        merged.push(parsed)
      }
    }

    // Sort by source_id then chunk_index so the LLM sees content in order.
    merged.sort((a, b) => {
      if (a.source_id !== b.source_id) return a.source_id.localeCompare(b.source_id)
      const ai = typeof a.metadata?.chunk_index === "number" ? a.metadata.chunk_index : 999
      const bi = typeof b.metadata?.chunk_index === "number" ? b.metadata.chunk_index : 999
      return ai - bi
    })

    return merged.slice(0, maxTotal)
  } catch (err: any) {
    console.warn("[rag] context window expansion failed (non-fatal):", err?.message ?? err)
    return chunks
  }
}
