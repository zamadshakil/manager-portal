import "server-only"

/**
 * RAG Retrieval – Native Next.js Implementation
 * ==============================================
 *
 * Performs vector similarity search directly against the `rag_documents`
 * pgvector table, eliminating the need for the external Python rag-service.
 *
 * Two retrieval strategies are combined via Reciprocal Rank Fusion (RRF):
 *   1. **Vector search** — cosine similarity against the query embedding
 *   2. **BM25 full-text** — tsvector/tsquery for keyword matching
 *
 * Results are then reranked by keyword overlap for precision.
 */

import { Pool } from "pg"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATABASE_URL = process.env.POSTGRES_URL ?? process.env.DATABASE_URL ?? ""
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? ""
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small"

// Score threshold for vector search — bypassed when a specific document is targeted
const SCORE_THRESHOLD = 0.25

// ---------------------------------------------------------------------------
// Singleton pool (shared with indexer if both modules are loaded)
// ---------------------------------------------------------------------------

let _pool: Pool | null = null

function getPool(): Pool | null {
  if (!DATABASE_URL) return null
  if (!_pool) {
    _pool = new Pool({
      connectionString: DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
  }
  return _pool
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
// Main retrieve function
// ---------------------------------------------------------------------------

export async function retrieveChunks(
  opts: RetrieveOptions,
): Promise<RetrievedChunk[]> {
  const pool = getPool()
  if (!pool) {
    console.warn("[rag] retrieval skipped: database not configured")
    return []
  }

  if (!OPENROUTER_API_KEY) {
    console.warn("[rag] retrieval skipped: no embedding API key")
    return []
  }

  const topK = opts.topK ?? 6
  const isTargeted = !!opts.documentId

  let client
  try {
    // 1. Embed the query
    const vector = await embedQuery(opts.query)
    const vectorStr = `[${vector.join(",")}]`

    client = await pool.connect()

    // 2. Build scoped WHERE clause
    const whereClauses: string[] = []
    const params: unknown[] = []
    let paramIdx = 1

    const isChatAttachment = opts.sourceType === "chat_attachment"

    if (isChatAttachment) {
      whereClauses.push(`owner_id = $${paramIdx}`)
      params.push(opts.scope.user_id)
      paramIdx++
    } else if (opts.scope.role === "member") {
      whereClauses.push(`owner_id = $${paramIdx}`)
      params.push(opts.scope.user_id)
      paramIdx++
    } else if (opts.scope.role === "manager" && opts.scope.team_id) {
      whereClauses.push(`(team_id = $${paramIdx} OR owner_id = $${paramIdx + 1})`)
      params.push(opts.scope.team_id, opts.scope.user_id)
      paramIdx += 2
    }

    if (opts.sourceType) {
      whereClauses.push(`source_type = $${paramIdx}`)
      params.push(opts.sourceType)
      paramIdx++
    }

    if (opts.documentId) {
      whereClauses.push(`source_id = $${paramIdx}`)
      params.push(opts.documentId)
      paramIdx++
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : ""
    const limitCount = topK * 3 // Fetch extra for RRF fusion headroom

    // 3. Vector similarity search
    const vecParamIdx = paramIdx
    const vecLimitIdx = paramIdx + 1

    const vectorSql = `
      SELECT id, source_type, source_id, title,
             LEFT(content, 800) AS snippet,
             metadata,
             1 - (embedding <=> $${vecParamIdx}::vector) AS score
      FROM rag_documents
      ${whereSql}
      ORDER BY embedding <=> $${vecParamIdx}::vector
      LIMIT $${vecLimitIdx}
    `

    const vectorRows = await client.query(vectorSql, [
      ...params,
      vectorStr,
      limitCount,
    ])

    // 4. BM25 full-text search (best effort)
    let bm25Results: RetrievedChunk[] = []
    try {
      const tsParamIdx = paramIdx
      const tsLimitIdx = paramIdx + 1
      let bm25Where = whereSql
      if (bm25Where) {
        bm25Where += ` AND tsv @@ plainto_tsquery('english', $${tsParamIdx})`
      } else {
        bm25Where = `WHERE tsv @@ plainto_tsquery('english', $${tsParamIdx})`
      }

      const bm25Sql = `
        SELECT id, source_type, source_id, title,
               LEFT(content, 800) AS snippet,
               metadata,
               ts_rank_cd(tsv, plainto_tsquery('english', $${tsParamIdx})) AS score
        FROM rag_documents
        ${bm25Where}
        ORDER BY score DESC
        LIMIT $${tsLimitIdx}
      `

      const bm25Rows = await client.query(bm25Sql, [
        ...params,
        opts.query,
        limitCount,
      ])

      bm25Results = bm25Rows.rows.map((r: any) => ({
        id: String(r.id),
        source_type: r.source_type,
        source_id: r.source_id,
        title: r.title,
        snippet: r.snippet,
        score: parseFloat(r.score),
        metadata: r.metadata ?? {},
      }))
    } catch (e) {
      // BM25 is best-effort
      console.warn("[rag] BM25 search failed (non-fatal):", e)
    }

    // 5. Parse vector results
    let vectorResults: RetrievedChunk[] = vectorRows.rows.map((r: any) => ({
      id: String(r.id),
      source_type: r.source_type,
      source_id: r.source_id,
      title: r.title,
      snippet: r.snippet,
      score: parseFloat(r.score),
      metadata: r.metadata ?? {},
    }))

    // Bypass threshold for targeted document searches
    if (!isTargeted) {
      vectorResults = vectorResults.filter((c) => c.score >= SCORE_THRESHOLD)
    }

    // 6. Reciprocal Rank Fusion
    let fused = bm25Results.length
      ? reciprocalRankFusion(vectorResults, bm25Results)
      : vectorResults

    // 7. Keyword reranking
    fused = rerankByKeywords(opts.query, fused)

    // 8. Deduplication — skip for targeted doc searches (we want multiple chunks)
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
  } finally {
    if (client) client.release()
  }
}
