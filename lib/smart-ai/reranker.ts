import "server-only"

/**
 * Cross-Encoder Reranker — Jina AI Reranker v2
 * ==============================================
 *
 * After vector + BM25 retrieval, the top chunks are re-scored using a
 * dedicated cross-encoder model. Cross-encoders see BOTH the query and
 * the document together (unlike bi-encoders which embed them separately),
 * so they produce much more accurate relevance scores.
 *
 * This is the single biggest accuracy improvement in RAG systems — it
 * bridges the "vocabulary gap" between user questions and document chunks.
 *
 * Uses Jina AI's reranker API which has a free tier (10M tokens).
 *
 * Env vars:
 *   JINA_API_KEY — required to enable cross-encoder reranking
 *   RERANKER_MODEL — optional, defaults to jina-reranker-v2-base-multilingual
 *   RERANKER_TOP_N — optional, how many top results to keep after reranking
 */

const JINA_API_KEY = process.env.JINA_API_KEY ?? ""
const RERANKER_MODEL =
  process.env.RERANKER_MODEL ?? "jina-reranker-v2-base-multilingual"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RerankDocument {
  /** Unique id to track which chunk this maps back to */
  id: string
  /** The text content to score against the query */
  text: string
}

interface JinaRerankResult {
  index: number
  relevance_score: number
  document?: { text: string }
}

interface JinaRerankResponse {
  model: string
  results: JinaRerankResult[]
  usage: { total_tokens: number }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true if cross-encoder reranking is available (API key configured).
 */
export function isRerankerConfigured(): boolean {
  return JINA_API_KEY.length > 10
}

/**
 * Re-score chunks using Jina's cross-encoder reranker.
 *
 * @param query  - The user's search query
 * @param docs   - Array of { id, text } objects (the retrieved chunks)
 * @param topN   - How many top results to return (default: all)
 * @returns Sorted array of { id, score } from most to least relevant
 */
export async function crossEncoderRerank(
  query: string,
  docs: RerankDocument[],
  topN?: number,
): Promise<{ id: string; score: number }[]> {
  if (!isRerankerConfigured()) {
    console.warn("[reranker] skipped: no JINA_API_KEY configured")
    return docs.map((d) => ({ id: d.id, score: 0 }))
  }

  if (docs.length === 0) return []
  if (docs.length === 1) return [{ id: docs[0].id, score: 1.0 }]

  const effectiveTopN = topN ?? docs.length

  try {
    const startMs = Date.now()

    const res = await fetch("https://api.jina.ai/v1/rerank", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${JINA_API_KEY}`,
      },
      body: JSON.stringify({
        model: RERANKER_MODEL,
        query,
        documents: docs.map((d) => d.text),
        top_n: effectiveTopN,
        return_documents: false,
      }),
      signal: AbortSignal.timeout(8_000), // 8s timeout
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown")
      console.error(
        `[reranker] Jina API error ${res.status}: ${errText.slice(0, 200)}`,
      )
      // Graceful fallback: return original order
      return docs.map((d) => ({ id: d.id, score: 0 }))
    }

    const data = (await res.json()) as JinaRerankResponse
    const elapsed = Date.now() - startMs

    console.log(
      `[reranker] reranked ${docs.length} docs → top ${data.results.length} ` +
        `(${elapsed}ms, ${data.usage.total_tokens} tokens, model: ${data.model})`,
    )

    // Map results back to our chunk IDs, sorted by relevance_score desc
    return data.results
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .map((r) => ({
        id: docs[r.index].id,
        score: r.relevance_score,
      }))
  } catch (err: any) {
    // Network errors, timeouts, etc — don't block the pipeline
    console.warn(
      "[reranker] cross-encoder failed (non-fatal):",
      err?.message ?? err,
    )
    return docs.map((d) => ({ id: d.id, score: 0 }))
  }
}
