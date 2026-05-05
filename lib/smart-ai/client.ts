import "server-only"
import type { Profile } from "@/lib/types"

/**
 * Smart AI shared types and helpers.
 *
 * Smart AI runs entirely natively inside the Next.js app:
 *   - Chat orchestration & tool calling: `app/api/smart-ai/chat/route.ts` (streamText + AI SDK)
 *   - RAG indexing/retrieval: `lib/smart-ai/{indexer,retriever}.ts` (Supabase + pgvector)
 *   - Analytics: `app/api/smart-ai/analytics/route.ts` (queries Supabase directly)
 *
 * The standalone `mcp-service` and `rag-service` Railway deployments have
 * been retired. This module now only carries the small shared types that
 * other server-only modules import.
 */

export interface ChatScope {
  user_id: string
  role: Profile["role"]
  team_id: string | null
}

export function scopeForProfile(profile: Profile): ChatScope {
  return {
    user_id: profile.id,
    role: profile.role,
    team_id: profile.team_id,
  }
}

export interface ChatMessage {
  role: "user" | "assistant" | "system"
  content: string
  metadata?: Record<string, any>
}

/**
 * Shape returned by `/api/smart-ai/analytics`. Lives here so server and
 * client (analytics panel) share one type definition.
 */
export interface RagAnalytics {
  index: {
    documents: number
    chunks: number
    last_indexed_at: string | null
    embedding_model: string
  }
  queries: {
    last_24h: number
    last_7d: number
    avg_latency_ms: number
    avg_top_k: number
  }
  timeseries: { ts: string; queries: number; tokens: number }[]
  top_topics: { topic: string; count: number }[]
  recent_queries: {
    id: string
    question: string
    role: Profile["role"]
    created_at: string
    latency_ms: number
    sources: number
  }[]
}
