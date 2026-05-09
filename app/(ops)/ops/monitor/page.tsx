"use client"

import { useCallback, useEffect, useRef, useState } from "react"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Summary {
  requests_24h: number
  errors_24h: number
  avg_latency_ms_24h: number | null
  error_events_24h: number
  unresolved_errors_24h: number
  ai_calls_24h: number
  open_issues: number
  active_users_15m?: number
  page_views_24h?: number
}

interface ErrorLog {
  id: string
  severity: string
  source: string
  error_message: string
  stack_trace: string | null
  path: string | null
  user_id: string | null
  fingerprint: string | null
  resolved_at: string | null
  created_at: string
}

interface ErrorGroup {
  fingerprint: string
  error_message: string
  source: string
  severity: string
  occurrences: number
  affected_users: number
  first_seen: string
  last_seen: string
  resolved: boolean
  sample_id: string
  sample_path: string | null
}

interface RequestLog {
  id: string
  method: string
  path: string
  status_code: number | null
  duration_ms: number | null
  user_id: string | null
  error_message: string | null
  created_at: string
}

interface PageView {
  id: string
  user_id: string | null
  user_email: string | null
  session_id: string | null
  pathname: string
  created_at: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rel(iso: string) {
  const d = Date.now() - new Date(iso).getTime()
  const m = Math.floor(d / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function statusColor(code: number | null) {
  if (!code) return "text-zinc-500"
  if (code >= 500) return "text-red-400"
  if (code >= 400) return "text-orange-400"
  if (code >= 300) return "text-blue-400"
  return "text-emerald-400"
}

function severityColor(s: string) {
  if (s === "error") return "bg-red-500/10 text-red-400"
  if (s === "warning") return "bg-yellow-500/10 text-yellow-400"
  return "bg-blue-500/10 text-blue-400"
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-5">
      <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">{label}</p>
      <p className={`text-2xl font-bold ${accent ?? "text-white"}`}>{value}</p>
      {sub && <p className="text-xs text-zinc-500 mt-1">{sub}</p>}
    </div>
  )
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = ["Overview", "Issues", "Errors", "Requests", "Activity"] as const
type Tab = typeof TABS[number]

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OpsMonitorPage() {
  const [tab, setTab] = useState<Tab>("Overview")
  const [summary, setSummary] = useState<Summary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true)
    try {
      const [s, a] = await Promise.all([
        fetch("/api/ops/monitor/summary").then((r) => r.json()),
        fetch("/api/ops/monitor/activity?limit=1").then((r) => r.json()),
      ])
      setSummary({ ...s, active_users_15m: a.active_users_15m, page_views_24h: a.page_views_24h })
    } finally {
      setSummaryLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSummary()
  }, [loadSummary])

  useEffect(() => {
    if (autoRefresh) {
      timerRef.current = setInterval(loadSummary, 30000)
    } else if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [autoRefresh, loadSummary])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Monitor</h1>
          <p className="text-sm text-zinc-500 mt-1">Real-time production observability — errors, requests, user activity.</p>
        </div>
        <div className="flex items-center gap-3">
          {autoRefresh && (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </span>
          )}
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors border border-zinc-700 px-3 py-1.5 rounded-md"
          >
            {autoRefresh ? "Pause" : "Resume"} auto-refresh
          </button>
          <button onClick={loadSummary} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors border border-zinc-700 px-3 py-1.5 rounded-md">
            Refresh
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {summaryLoading && !summary ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => <div key={i} className="rounded-xl bg-zinc-900 border border-zinc-800 h-24 animate-pulse" />)}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Requests (24h)" value={summary.requests_24h.toLocaleString()} />
          <StatCard label="HTTP Errors (24h)" value={summary.errors_24h.toLocaleString()} accent={summary.errors_24h > 0 ? "text-orange-400" : "text-white"} />
          <StatCard label="Avg Latency" value={summary.avg_latency_ms_24h != null ? `${summary.avg_latency_ms_24h}ms` : "—"} />
          <StatCard label="AI Calls (24h)" value={summary.ai_calls_24h.toLocaleString()} />
          <StatCard label="Error Events (24h)" value={summary.error_events_24h.toLocaleString()} accent={summary.error_events_24h > 0 ? "text-red-400" : "text-white"} />
          <StatCard label="Open Issues" value={summary.open_issues} accent={summary.open_issues > 0 ? "text-red-400" : "text-white"} sub="grouped by fingerprint" />
          <StatCard label="Active Users (15m)" value={summary.active_users_15m ?? 0} sub="from browser activity" />
          <StatCard label="Page Views (24h)" value={(summary.page_views_24h ?? 0).toLocaleString()} sub="client-tracked" />
        </div>
      ) : null}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-zinc-800">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t
                ? "border-orange-500 text-white"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && <OverviewTab />}
      {tab === "Issues" && <IssuesTab />}
      {tab === "Errors" && <ErrorsTab />}
      {tab === "Requests" && <RequestsTab />}
      {tab === "Activity" && <ActivityTab />}
    </div>
  )
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Section title="Top Issues (7d)">
        <IssuesTable limit={5} />
      </Section>
      <Section title="Recent Client Errors">
        <ErrorsTable source="client" limit={5} />
      </Section>
      <Section title="Recent HTTP Errors">
        <RequestsTable minStatus={400} limit={8} />
      </Section>
      <Section title="Recent Activity">
        <ActivityTable limit={8} />
      </Section>
    </div>
  )
}

// ─── Issues Tab ───────────────────────────────────────────────────────────────

function IssuesTab() {
  return (
    <Section title="All Issues (7d)" action={<span className="text-xs text-zinc-500">Grouped by error fingerprint</span>}>
      <IssuesTable limit={100} />
    </Section>
  )
}

// ─── Errors Tab ───────────────────────────────────────────────────────────────

function ErrorsTab() {
  const [source, setSource] = useState("")
  const [severity, setSeverity] = useState("")

  return (
    <Section
      title="Error Logs"
      action={
        <div className="flex items-center gap-2">
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="text-xs bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-md px-2 py-1"
          >
            <option value="">All sources</option>
            <option value="client">Client</option>
            <option value="api">API</option>
            <option value="server">Server</option>
            <option value="cron">Cron</option>
            <option value="pipeline">Pipeline</option>
            <option value="ai">AI</option>
          </select>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            className="text-xs bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-md px-2 py-1"
          >
            <option value="">All severities</option>
            <option value="error">Error</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>
        </div>
      }
    >
      <ErrorsTable source={source} severity={severity} limit={50} />
    </Section>
  )
}

// ─── Requests Tab ─────────────────────────────────────────────────────────────

function RequestsTab() {
  const [method, setMethod] = useState("")
  const [minStatus, setMinStatus] = useState("")

  return (
    <Section
      title="Request Logs"
      action={
        <div className="flex items-center gap-2">
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="text-xs bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-md px-2 py-1"
          >
            <option value="">All methods</option>
            {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => <option key={m}>{m}</option>)}
          </select>
          <select
            value={minStatus}
            onChange={(e) => setMinStatus(e.target.value)}
            className="text-xs bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-md px-2 py-1"
          >
            <option value="">All status</option>
            <option value="400">4xx+ errors</option>
            <option value="500">5xx only</option>
          </select>
        </div>
      }
    >
      <RequestsTable method={method} minStatus={minStatus ? Number(minStatus) : undefined} limit={50} />
    </Section>
  )
}

// ─── Activity Tab ─────────────────────────────────────────────────────────────

function ActivityTab() {
  return (
    <Section title="User Page Activity" action={<span className="text-xs text-zinc-500">Captured by browser collector</span>}>
      <ActivityTable limit={100} />
    </Section>
  )
}

// ─── Data Tables ──────────────────────────────────────────────────────────────

function IssuesTable({ limit }: { limit: number }) {
  const [groups, setGroups] = useState<ErrorGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [resolving, setResolving] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/ops/monitor/errors?view=groups")
      .then((r) => r.json())
      .then((d) => { setGroups(d.groups ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function resolve(fp: string, sampleId: string) {
    setResolving(fp)
    await fetch("/api/ops/monitor/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: sampleId }) })
    setGroups((g) => g.map((x) => x.fingerprint === fp ? { ...x, resolved: true } : x))
    setResolving(null)
  }

  if (loading) return <div className="h-32 animate-pulse bg-zinc-800 rounded-lg" />

  const items = groups.slice(0, limit)
  if (items.length === 0) return <p className="text-sm text-zinc-500 py-4 text-center">No issues found</p>

  return (
    <div className="space-y-2">
      {items.map((g) => (
        <div key={g.fingerprint} className={`rounded-lg border p-3 ${g.resolved ? "border-zinc-800/40 opacity-50" : "border-zinc-700"}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${severityColor(g.severity)}`}>{g.severity}</span>
                <span className="text-[10px] text-zinc-600 bg-zinc-800 px-1.5 py-0.5 rounded-full">{g.source}</span>
                <span className="text-[10px] text-zinc-500">{g.occurrences}× · {g.affected_users} user{g.affected_users !== 1 ? "s" : ""}</span>
                <span className="text-[10px] text-zinc-600">last {rel(g.last_seen)}</span>
              </div>
              <p className="text-xs text-zinc-300 font-mono truncate">{g.error_message}</p>
              {g.sample_path && <p className="text-[10px] text-zinc-600 mt-0.5 truncate">{g.sample_path}</p>}
            </div>
            {!g.resolved && (
              <button
                onClick={() => resolve(g.fingerprint, g.sample_id)}
                disabled={resolving === g.fingerprint}
                className="text-[10px] text-zinc-500 hover:text-emerald-400 border border-zinc-700 px-2 py-1 rounded-md whitespace-nowrap transition-colors"
              >
                {resolving === g.fingerprint ? "…" : "Resolve"}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function ErrorsTable({ source, severity, limit }: { source?: string; severity?: string; limit: number }) {
  const [rows, setRows] = useState<ErrorLog[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams({ limit: String(limit) })
    if (source) params.set("source", source)
    if (severity) params.set("severity", severity)
    setLoading(true)
    fetch(`/api/ops/monitor/errors?${params}`)
      .then((r) => r.json())
      .then((d) => { setRows(d.rows ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [source, severity, limit])

  if (loading) return <div className="h-32 animate-pulse bg-zinc-800 rounded-lg" />
  if (rows.length === 0) return <p className="text-sm text-zinc-500 py-4 text-center">No errors found</p>

  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.id}>
          <button
            onClick={() => setExpanded(expanded === r.id ? null : r.id)}
            className="w-full text-left rounded-lg bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700/40 px-3 py-2.5 transition-colors"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${severityColor(r.severity)}`}>{r.severity}</span>
              <span className="text-[10px] bg-zinc-700 text-zinc-400 px-1.5 py-0.5 rounded-full">{r.source}</span>
              <span className="text-xs text-zinc-300 font-mono truncate flex-1">{r.error_message.slice(0, 120)}</span>
              <span className="text-[10px] text-zinc-600 whitespace-nowrap">{rel(r.created_at)}</span>
            </div>
          </button>
          {expanded === r.id && (
            <div className="mt-1 rounded-lg bg-zinc-950 border border-zinc-700/40 p-3 text-xs space-y-2">
              <div className="grid grid-cols-2 gap-2 text-zinc-400">
                <div><span className="text-zinc-600">Path:</span> {r.path ?? "—"}</div>
                <div><span className="text-zinc-600">User:</span> {r.user_id ? r.user_id.slice(0, 8) + "…" : "anonymous"}</div>
                <div><span className="text-zinc-600">Resolved:</span> {r.resolved_at ? rel(r.resolved_at) : "No"}</div>
                <div><span className="text-zinc-600">ID:</span> {r.id.slice(0, 8)}</div>
              </div>
              {r.stack_trace && (
                <pre className="text-[10px] text-zinc-500 overflow-x-auto whitespace-pre-wrap max-h-40 font-mono">{r.stack_trace}</pre>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function RequestsTable({ method, minStatus, limit }: { method?: string; minStatus?: number; limit: number }) {
  const [rows, setRows] = useState<RequestLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const params = new URLSearchParams({ limit: String(limit) })
    if (method) params.set("method", method)
    if (minStatus) params.set("min_status", String(minStatus))
    setLoading(true)
    fetch(`/api/ops/monitor/requests?${params}`)
      .then((r) => r.json())
      .then((d) => { setRows(d.rows ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [method, minStatus, limit])

  if (loading) return <div className="h-32 animate-pulse bg-zinc-800 rounded-lg" />
  if (rows.length === 0) return <p className="text-sm text-zinc-500 py-4 text-center">No requests found</p>

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-zinc-600 border-b border-zinc-800">
            <th className="py-2 pr-3">Method</th>
            <th className="py-2 pr-3">Path</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3">Latency</th>
            <th className="py-2">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/50">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-zinc-800/30 transition-colors">
              <td className="py-2 pr-3 font-mono text-zinc-400">{r.method}</td>
              <td className="py-2 pr-3 font-mono text-zinc-300 max-w-[200px] truncate">{r.path}</td>
              <td className={`py-2 pr-3 font-semibold ${statusColor(r.status_code)}`}>{r.status_code ?? "—"}</td>
              <td className="py-2 pr-3 text-zinc-400">{r.duration_ms != null ? `${r.duration_ms}ms` : "—"}</td>
              <td className="py-2 text-zinc-600 whitespace-nowrap">{rel(r.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ActivityTable({ limit }: { limit: number }) {
  const [rows, setRows] = useState<PageView[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/ops/monitor/activity?limit=${limit}`)
      .then((r) => r.json())
      .then((d) => { setRows(d.rows ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [limit])

  if (loading) return <div className="h-32 animate-pulse bg-zinc-800 rounded-lg" />
  if (rows.length === 0) return <p className="text-sm text-zinc-500 py-4 text-center">No page views recorded yet. Activity is captured from browser sessions.</p>

  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-3 rounded-lg bg-zinc-800/40 border border-zinc-700/30 px-3 py-2">
          <div className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center text-[10px] text-zinc-400 flex-shrink-0">
            {(r.user_email?.[0] ?? "?").toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-zinc-300 font-mono truncate">{r.pathname}</p>
            <p className="text-[10px] text-zinc-600">{r.user_email ?? "anonymous"}</p>
          </div>
          <span className="text-[10px] text-zinc-600 whitespace-nowrap">{rel(r.created_at)}</span>
        </div>
      ))}
    </div>
  )
}
