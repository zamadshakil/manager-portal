import { NextResponse, type NextRequest } from "next/server"
import { withRequestLog } from "@/lib/logger"
import { requireProfile } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { scopeForProfile, type RagAnalytics } from "@/lib/smart-ai/client"
import type { Profile } from "@/lib/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/smart-ai/analytics
 *
 * Computes Smart AI analytics natively from Supabase tables — no external
 * RAG service required. Pulls:
 *   - index stats from `rag_documents`
 *   - query/usage stats from `ai_usage_log`
 *   - recent question samples from `chat_messages`
 *
 * Returns a deterministic empty payload when Supabase isn't configured so
 * the dashboard renders without a loading-error flash.
 */
async function getHandler(_req: NextRequest) {
  const profile = await requireProfile()
  const scope = scopeForProfile(profile)

  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch {
    return NextResponse.json(
      { source: "fallback", scope, data: emptyAnalytics() },
      { headers: { "cache-control": "private, max-age=15" } },
    )
  }

  try {
    const [index, queries, timeseries, recent, topics] = await Promise.all([
      loadIndexStats(admin, profile),
      loadQueryStats(admin, profile),
      loadTimeseries(admin, profile),
      loadRecentQuestions(admin, profile),
      loadTopTopics(admin, profile),
    ])

    const data: RagAnalytics = {
      index,
      queries,
      timeseries,
      top_topics: topics,
      recent_queries: recent,
    }

    return NextResponse.json(
      { source: "native", scope, data },
      { headers: { "cache-control": "private, max-age=15" } },
    )
  } catch (err: any) {
    console.error("[smart-ai] analytics native query failed:", err?.message ?? err)
    return NextResponse.json(
      { source: "fallback", scope, data: emptyAnalytics() },
      { headers: { "cache-control": "private, max-age=15" } },
    )
  }
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "openai/text-embedding-3-small"

type Admin = ReturnType<typeof createAdminClient>

/** Role-based scope filter applied to rag_documents. */
function ragOwnershipFilter(query: any, profile: Profile) {
  if (profile.role === "main_admin") return query // sees everything
  if (profile.role === "manager" && profile.team_id) {
    return query.or(`team_id.eq.${profile.team_id},owner_id.eq.${profile.id}`)
  }
  return query.eq("owner_id", profile.id)
}

async function loadIndexStats(admin: Admin, profile: Profile): Promise<RagAnalytics["index"]> {
  // Total chunks (the row count) — fast HEAD query.
  const chunksQuery = ragOwnershipFilter(
    admin.from("rag_documents").select("*", { count: "exact", head: true }),
    profile,
  )
  const { count: chunks } = await chunksQuery

  // Distinct documents — pull a thin column and count unique source_ids.
  const docsQuery = ragOwnershipFilter(
    admin.from("rag_documents").select("source_id, source_type, created_at"),
    profile,
  ).limit(10_000)
  const { data: docRows } = await docsQuery
  const uniqueDocs = new Set((docRows ?? []).map((r: any) => `${r.source_type}:${r.source_id}`)).size
  const lastIndexed = (docRows ?? [])
    .map((r: any) => r.created_at)
    .sort()
    .pop() ?? null

  return {
    documents: uniqueDocs,
    chunks: chunks ?? 0,
    last_indexed_at: lastIndexed,
    embedding_model: EMBEDDING_MODEL,
  }
}

async function loadQueryStats(admin: Admin, profile: Profile): Promise<RagAnalytics["queries"]> {
  const now = Date.now()
  const day = new Date(now - 24 * 60 * 60 * 1000).toISOString()
  const week = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()

  const usageScoped = (q: any) => (profile.role === "main_admin" ? q : q.eq("user_id", profile.id))

  const { count: dayCount } = await usageScoped(
    admin.from("ai_usage_log").select("*", { count: "exact", head: true }).gte("created_at", day),
  )
  const { count: weekCount } = await usageScoped(
    admin.from("ai_usage_log").select("*", { count: "exact", head: true }).gte("created_at", week),
  )

  return {
    last_24h: dayCount ?? 0,
    last_7d: weekCount ?? 0,
    avg_latency_ms: 0, // not tracked yet — leave as 0 (panel renders "—")
    avg_top_k: 6,
  }
}

async function loadTimeseries(admin: Admin, profile: Profile): Promise<RagAnalytics["timeseries"]> {
  const now = Date.now()
  const since = new Date(now - 24 * 60 * 60 * 1000).toISOString()

  const usageScoped = (q: any) => (profile.role === "main_admin" ? q : q.eq("user_id", profile.id))

  const { data: rows } = await usageScoped(
    admin
      .from("ai_usage_log")
      .select("created_at, tokens_in, tokens_out")
      .gte("created_at", since),
  )

  // Bucket into 24 hourly slots, oldest → newest, so the chart x-axis flows naturally.
  const buckets: { ts: string; queries: number; tokens: number }[] = Array.from({ length: 24 }).map(
    (_, i) => ({
      ts: new Date(now - (23 - i) * 60 * 60 * 1000).toISOString(),
      queries: 0,
      tokens: 0,
    }),
  )

  for (const r of rows ?? []) {
    const t = new Date(r.created_at as string).getTime()
    const idx = 23 - Math.floor((now - t) / (60 * 60 * 1000))
    if (idx >= 0 && idx < 24) {
      buckets[idx].queries += 1
      buckets[idx].tokens += (r.tokens_in ?? 0) + (r.tokens_out ?? 0)
    }
  }

  return buckets
}

async function loadRecentQuestions(
  admin: Admin,
  profile: Profile,
): Promise<RagAnalytics["recent_queries"]> {
  // For main_admin we show every team's questions; otherwise only the user's.
  let threadIds: string[] | null = null
  if (profile.role !== "main_admin") {
    const { data: threads } = await admin
      .from("chat_threads")
      .select("id")
      .eq("user_id", profile.id)
      .order("updated_at", { ascending: false })
      .limit(50)
    threadIds = (threads ?? []).map((t) => t.id)
    if (!threadIds.length) return []
  }

  let q = admin
    .from("chat_messages")
    .select("id, content, created_at, thread_id")
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(20)

  if (threadIds) q = q.in("thread_id", threadIds)

  const { data: msgs } = await q
  if (!msgs?.length) return []

  return msgs.map((m) => ({
    id: String(m.id),
    question: stripAttachmentBlock(String(m.content ?? "")).slice(0, 240),
    role: profile.role,
    created_at: m.created_at as string,
    latency_ms: 0,
    sources: 0,
  }))
}

async function loadTopTopics(admin: Admin, profile: Profile): Promise<RagAnalytics["top_topics"]> {
  const docsQuery = ragOwnershipFilter(
    admin.from("rag_documents").select("source_type"),
    profile,
  ).limit(5_000)
  const { data } = await docsQuery
  if (!data?.length) return []

  const counts = new Map<string, number>()
  for (const r of data) {
    const k = humanizeSourceType(String(r.source_type))
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function humanizeSourceType(t: string): string {
  switch (t) {
    case "chat_attachment":
      return "Chat attachments"
    case "submission":
      return "Submissions"
    case "task":
      return "Tasks"
    case "announcement":
      return "Announcements"
    case "material":
      return "Materials"
    case "validation_run":
      return "Validation runs"
    case "rule":
      return "Rules"
    default:
      return t
  }
}

function stripAttachmentBlock(text: string): string {
  return text.replace(/\n*\[Attached documents][\s\S]*$/, "").trim()
}

function emptyAnalytics(): RagAnalytics {
  const now = Date.now()
  const timeseries = Array.from({ length: 24 }).map((_, i) => ({
    ts: new Date(now - (23 - i) * 60 * 60 * 1000).toISOString(),
    queries: 0,
    tokens: 0,
  }))
  return {
    index: {
      documents: 0,
      chunks: 0,
      last_indexed_at: null,
      embedding_model: EMBEDDING_MODEL,
    },
    queries: { last_24h: 0, last_7d: 0, avg_latency_ms: 0, avg_top_k: 6 },
    timeseries,
    top_topics: [],
    recent_queries: [],
  }
}

export const GET = withRequestLog(getHandler)
