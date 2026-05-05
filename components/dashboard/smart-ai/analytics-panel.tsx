"use client"

import useSWR from "swr"
import {
  BarChart3,
  Database,
  Clock3,
  Layers,
  Sparkles,
  TrendingUp,
  History,
} from "lucide-react"
import { useState, useEffect } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { cn } from "@/lib/utils"
import { formatRelative } from "@/lib/format"
import type { RagAnalytics } from "@/lib/smart-ai/client"
import { createClient } from "@/lib/supabase/client"

interface AnalyticsResponse {
  source: "native" | "fallback"
  scope: { user_id: string; role: string; team_id: string | null }
  data: RagAnalytics
}

const fetcher = async (url: string): Promise<AnalyticsResponse> => {
  const res = await fetch(url, { credentials: "same-origin" })
  if (!res.ok) throw new Error(`Failed to load analytics (${res.status})`)
  return res.json()
}

export function AnalyticsPanel() {
  const { data, error, isLoading, mutate } = useSWR<AnalyticsResponse>(
    "/api/smart-ai/analytics",
    fetcher,
    { refreshInterval: 10_000, revalidateOnFocus: true },
  )

  useEffect(() => {
    const supabase = createClient()
    
    // Listen for new chat messages to refresh analytics instantly
    const channel = supabase
      .channel("analytics-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: "role=eq.user" },
        () => {
          // Instead of manually managing complex state, we just trigger a revalidation
          // which is "within a sec" on a fast connection.
          void mutate()
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [mutate])

  if (isLoading) return <AnalyticsSkeleton />
  if (error) return <AnalyticsError message={error.message} />
  if (!data) return null

  const a = data.data
  const isLive = data.source === "native"

  return (
    <div className="space-y-4 lg:space-y-6 min-w-0">
      {!isLive ? (
        <div className="rounded-xl border border-[#dd5b00]/20 bg-[#fff8e1] px-4 py-3 text-[12.5px] text-[#7a5b00] flex items-start gap-2">
          <Sparkles className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
          <p>
            Showing a placeholder snapshot. Configure the Supabase service-role key so analytics
            can read from <code className="font-mono">rag_documents</code> and{" "}
            <code className="font-mono">ai_usage_log</code>.
          </p>
        </div>
      ) : null}

      {/* KPI grid */}
      <section
        aria-label="Retrieval key metrics"
        className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4"
      >
        <KpiCard
          label="Indexed documents"
          value={a.index.documents.toLocaleString()}
          hint={`${a.index.chunks.toLocaleString()} chunks`}
          icon={Database}
          tone="default"
        />
        <KpiCard
          label="Queries (24h)"
          value={a.queries.last_24h.toLocaleString()}
          hint={`${a.queries.last_7d.toLocaleString()} this week`}
          icon={TrendingUp}
          tone="ok"
        />
        <KpiCard
          label="Avg latency"
          value={a.queries.avg_latency_ms > 0 ? `${a.queries.avg_latency_ms} ms` : "—"}
          hint="end-to-end retrieval"
          icon={Clock3}
        />
        <KpiCard
          label="Avg top-k"
          value={a.queries.avg_top_k.toString()}
          hint="chunks per answer"
          icon={Layers}
        />
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 lg:gap-6 min-w-0">
        {/* Query volume chart */}
        <section
          aria-labelledby="smart-ai-volume-heading"
          className="xl:col-span-2 rounded-xl border border-border bg-card shadow-card overflow-hidden"
        >
          <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 lg:px-5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-warm-white">
              <BarChart3 className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 id="smart-ai-volume-heading" className="text-[15px] font-semibold tracking-tight">
                Query volume (24h)
              </h2>
              <p className="text-[12px] text-muted-foreground">
                Hourly bucketed queries against the pgvector index.
              </p>
            </div>
          </header>
          <div className="px-3 py-4 lg:px-4 lg:py-5">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={a.timeseries.map((p) => ({ ...p, label: hourLabel(p.ts) }))}>
                <CartesianGrid stroke="rgba(0,0,0,0.06)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "#615d59" }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "#615d59" }}
                  width={28}
                />
                <Tooltip
                  cursor={{ fill: "rgba(0,0,0,0.04)" }}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid rgba(0,0,0,0.1)",
                    boxShadow: "var(--shadow-card)",
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="queries" fill="var(--notion-blue)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Top topics */}
        <section
          aria-labelledby="smart-ai-topics-heading"
          className="rounded-xl border border-border bg-card shadow-card overflow-hidden"
        >
          <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 lg:px-5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-warm-white">
              <Layers className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 id="smart-ai-topics-heading" className="text-[15px] font-semibold tracking-tight">
                Top retrieved topics
              </h2>
              <p className="text-[12px] text-muted-foreground">
                What people are asking about most.
              </p>
            </div>
          </header>
          {a.top_topics.length === 0 ? (
            <div className="px-5 py-10 text-center text-[12.5px] text-muted-foreground">
              No queries yet. Ask Smart AI a question to populate this list.
            </div>
          ) : (
            <ul className="px-4 py-3 lg:px-5 lg:py-4 space-y-2.5">
              {a.top_topics.map((t, i) => {
                const max = Math.max(1, ...a.top_topics.map((x) => x.count))
                const pct = (t.count / max) * 100
                return (
                  <li key={t.topic} className="space-y-1">
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="font-semibold text-foreground/80">
                        {i + 1}. {t.topic}
                      </span>
                      <span className="font-mono text-muted-foreground">{t.count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-warm-white overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.max(4, pct)}%` }}
                        aria-hidden="true"
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      {/* Latency trend + recent queries */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 lg:gap-6 min-w-0">
        <section
          aria-labelledby="smart-ai-tokens-heading"
          className="xl:col-span-1 rounded-xl border border-border bg-card shadow-card overflow-hidden"
        >
          <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 lg:px-5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-warm-white">
              <TrendingUp className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 id="smart-ai-tokens-heading" className="text-[15px] font-semibold tracking-tight">
                Tokens / hour
              </h2>
              <p className="text-[12px] text-muted-foreground">
                Embedding + completion tokens.
              </p>
            </div>
          </header>
          <div className="px-3 py-4">
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={a.timeseries.map((p) => ({ ...p, label: hourLabel(p.ts) }))}>
                <CartesianGrid stroke="rgba(0,0,0,0.06)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "#615d59" }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "#615d59" }}
                  width={36}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid rgba(0,0,0,0.1)",
                    boxShadow: "var(--shadow-card)",
                    fontSize: 12,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="tokens"
                  stroke="var(--notion-blue)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section
          aria-labelledby="smart-ai-recent-heading"
          className="xl:col-span-2 rounded-xl border border-border bg-card shadow-card overflow-hidden"
        >
          <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 lg:px-5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-warm-white">
              <History className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 id="smart-ai-recent-heading" className="text-[15px] font-semibold tracking-tight">
                Recent questions
              </h2>
              <p className="text-[12px] text-muted-foreground">
                Latest user prompts captured in <code className="font-mono">chat_messages</code>.
              </p>
            </div>
          </header>
          {a.recent_queries.length === 0 ? (
            <div className="px-5 py-10 text-center text-[12.5px] text-muted-foreground">
              No questions yet. Once your team starts using Smart AI, every prompt will appear
              here with retrieval metadata.
            </div>
          ) : (
            <ul className="divide-y divide-border max-h-[340px] overflow-y-auto scrollbar-thin">
              {a.recent_queries.map((q) => (
                <li key={q.id} className="px-4 py-3 lg:px-5">
                  <p className="text-[13px] font-semibold leading-snug truncate">{q.question}</p>
                  <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center rounded-full bg-warm-white px-2 py-0.5 font-semibold capitalize">
                      {q.role.replace("_", " ")}
                    </span>
                    <span>{q.sources} sources</span>
                    <span>·</span>
                    <span>{q.latency_ms} ms</span>
                    <span className="ml-auto">{formatRelative(q.created_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Index health footer */}
      <section
        aria-labelledby="smart-ai-index-heading"
        className="rounded-xl border border-border bg-card shadow-card overflow-hidden"
      >
        <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 lg:px-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-warm-white">
            <Database className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="smart-ai-index-heading" className="text-[15px] font-semibold tracking-tight">
              Vector index health
            </h2>
            <p className="text-[12px] text-muted-foreground">
              pgvector backing store inside Supabase (<code className="font-mono">rag_documents</code>).
            </p>
          </div>
        </header>
        <dl className="grid grid-cols-2 lg:grid-cols-4 px-4 py-4 lg:px-5 gap-y-3">
          <Detail label="Documents" value={a.index.documents.toLocaleString()} />
          <Detail label="Chunks" value={a.index.chunks.toLocaleString()} />
          <Detail
            label="Last sync"
            value={a.index.last_indexed_at ? formatRelative(a.index.last_indexed_at) : "Pending"}
          />
          <Detail label="Embedding model" value={a.index.embedding_model} mono />
        </dl>
      </section>
    </div>
  )
}

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string
  value: string
  hint?: string
  icon: React.ComponentType<{ className?: string }>
  tone?: "default" | "ok" | "warn"
}) {
  return (
    <article className="rounded-xl border border-border bg-card p-4 lg:p-5 shadow-card transition-shadow hover:shadow-deep">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
          {label}
        </p>
        <span
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-lg shrink-0",
            tone === "warn" && "bg-[#fff1e6] text-[#a4400a]",
            tone === "ok" && "bg-[#e8f8eb] text-[#157a2a]",
            tone === "default" && "bg-[#f2f9ff] text-[#097fe8]",
          )}
        >
          <Icon className="h-[14px] w-[14px]" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-3 text-[26px] font-semibold tracking-tight leading-none">{value}</p>
      {hint ? <p className="mt-1.5 text-[12px] text-muted-foreground">{hint}</p> : null}
    </article>
  )
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {label}
      </dt>
      <dd className={cn("mt-1 text-[13px] font-semibold truncate", mono && "font-mono text-[12px]")}>
        {value}
      </dd>
    </div>
  )
}

function hourLabel(iso: string): string {
  const d = new Date(iso)
  const h = d.getHours()
  return `${h.toString().padStart(2, "0")}h`
}

function AnalyticsSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-4 animate-pulse">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[112px] rounded-xl border border-border bg-card shadow-card" />
        ))}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 lg:gap-6">
        <div className="xl:col-span-2 h-[280px] rounded-xl border border-border bg-card shadow-card" />
        <div className="h-[280px] rounded-xl border border-border bg-card shadow-card" />
      </div>
    </div>
  )
}

function AnalyticsError({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-[#dd5b00]/20 bg-[#fff1e6] px-5 py-4 text-[13px] text-[#a4400a]">
      <strong className="font-semibold">Couldn&apos;t load analytics.</strong> {message}
    </div>
  )
}
