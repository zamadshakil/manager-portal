import "server-only"
import type { Profile } from "@/lib/types"

/**
 * Smart AI service clients.
 *
 * The portal talks to two services that live alongside the Next.js app in
 * the monorepo and are deployed to Railway:
 *
 *   1. mcp-service  (Node.js)  → exposes a Model Context Protocol surface
 *      that the chat UI calls. It in turn calls the rag-service for
 *      document retrieval and uses LangChain/LangGraph for orchestration.
 *
 *   2. rag-service  (FastAPI) → embeds documents into pgvector, performs
 *      similarity search, and surfaces analytics about the index.
 *
 * Both services authenticate via a shared bearer token. The Next route
 * never touches user input directly — it forwards a *role-scoped* request
 * so the backend can enforce row-level security identically to Supabase.
 *
 * If the env vars are not set yet (e.g. before Railway deployment), the
 * helpers return `null` and the API routes fall back to a graceful local
 * implementation so the UI remains functional during development.
 */

const MCP_URL = process.env.MCP_SERVICE_URL ?? ""
const MCP_TOKEN = process.env.MCP_SERVICE_TOKEN ?? ""
const RAG_URL = process.env.RAG_SERVICE_URL ?? ""
const RAG_TOKEN = process.env.RAG_SERVICE_TOKEN ?? ""

export function isMcpConfigured(): boolean {
  return Boolean(MCP_URL && MCP_TOKEN)
}

export function isRagConfigured(): boolean {
  return Boolean(RAG_URL && RAG_TOKEN)
}

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
 * POSTs a chat turn to the MCP service and returns the streaming response
 * (text/event-stream-like newline-delimited tokens). Caller is responsible
 * for piping the response back to the browser.
 */
export async function streamChatFromMcp(args: {
  scope: ChatScope
  accessToken: string | null
  threadId?: string | null
  messages: ChatMessage[]
  signal?: AbortSignal
}): Promise<Response | null> {
  if (!isMcpConfigured()) return null

  const res = await fetch(`${MCP_URL.replace(/\/$/, "")}/v1/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${MCP_TOKEN}`,
    },
    body: JSON.stringify({
      scope: args.scope,
      accessToken: args.accessToken,
      threadId: args.threadId,
      messages: args.messages,
      stream: true,
    }),
    signal: args.signal,
    // No caching — chat is per-request.
    cache: "no-store",
  })

  if (!res.ok || !res.body) return null
  return res
}

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

export async function fetchRagAnalytics(args: {
  scope: ChatScope
  signal?: AbortSignal
}): Promise<RagAnalytics | null> {
  if (!isRagConfigured()) return null

  const url = new URL(`${RAG_URL.replace(/\/$/, "")}/v1/analytics`)
  url.searchParams.set("role", args.scope.role)
  if (args.scope.team_id) url.searchParams.set("team_id", args.scope.team_id)
  url.searchParams.set("user_id", args.scope.user_id)

  const res = await fetch(url, {
    headers: { authorization: `Bearer ${RAG_TOKEN}` },
    signal: args.signal,
    cache: "no-store",
  })
  if (!res.ok) return null
  return (await res.json()) as RagAnalytics
}

/**
 * Fallback analytics computed entirely from values the front-end already
 * knows about. Lets the page render shape-complete data while Railway is
 * still being provisioned.
 */
export function fallbackAnalytics(scope: ChatScope): RagAnalytics {
  const now = Date.now()
  const timeseries = Array.from({ length: 24 }).map((_, i) => {
    const ts = new Date(now - (23 - i) * 60 * 60 * 1000).toISOString()
    // Deterministic-ish wave so the chart renders predictably.
    const base = 4 + Math.round(Math.sin(i / 3) * 3 + i / 4)
    return { ts, queries: Math.max(0, base), tokens: Math.max(0, base) * 220 }
  })

  return {
    index: {
      documents: 0,
      chunks: 0,
      last_indexed_at: null,
      embedding_model: "text-embedding-3-small",
    },
    queries: {
      last_24h: timeseries.reduce((a, b) => a + b.queries, 0),
      last_7d: timeseries.reduce((a, b) => a + b.queries, 0) * 6,
      avg_latency_ms: 0,
      avg_top_k: 6,
    },
    timeseries,
    top_topics: [
      { topic: "Submissions", count: 0 },
      { topic: "Validation rules", count: 0 },
      { topic: "Tasks", count: 0 },
      { topic: "Team performance", count: 0 },
      { topic: "Materials", count: 0 },
    ],
    recent_queries: [],
  }
}
