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

const TABS = ["Overview", "Issues", "Errors", "Requests", "Activity", "Users"] as const
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
      {tab === "Users" && <UsersTab />}
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

// ─── Users Tab ────────────────────────────────────────────────────────────────

interface UserRow {
  id: string
  email: string
  full_name: string | null
  role: string
  status: "online" | "recent" | "offline"
  last_seen_at: string | null
  last_pathname: string | null
  errors_7d: number
  last_session_event: string | null
  deleted_at: string | null
}

interface UserDetail {
  profile: UserRow
  sessions: any[]
  errors: any[]
  network_errors: any[]
  page_views: any[]
  timeline: Array<{ kind: string; at: string; data: any }>
}

const STATUS_DOT: Record<string, string> = {
  online: "bg-emerald-400 animate-pulse",
  recent: "bg-yellow-400",
  offline: "bg-zinc-600",
}
const STATUS_LABEL: Record<string, string> = {
  online: "Online",
  recent: "Recently active",
  offline: "Offline",
}
const ROLE_BADGE: Record<string, string> = {
  main_admin: "bg-orange-500/15 text-orange-400",
  manager: "bg-blue-500/15 text-blue-400",
  member: "bg-zinc-700 text-zinc-400",
}

function UsersTab() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<UserDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    fetch("/api/ops/monitor/users")
      .then((r) => r.json())
      .then((d) => { setUsers(d.users ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  function openDetail(userId: string) {
    setSelected(userId)
    setDetail(null)
    setDetailLoading(true)
    fetch(`/api/ops/monitor/users/${userId}`)
      .then((r) => r.json())
      .then((d) => { setDetail(d); setDetailLoading(false) })
      .catch(() => setDetailLoading(false))
  }

  if (loading) return <div className="h-40 animate-pulse bg-zinc-900 rounded-xl border border-zinc-800" />

  const online = users.filter((u) => u.status === "online").length
  const recent = users.filter((u) => u.status === "recent").length

  return (
    <div className="flex gap-6">
      {/* User list */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-4 mb-4">
          <span className="text-sm text-zinc-400">{users.length} total</span>
          <span className="flex items-center gap-1.5 text-xs text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />{online} online
          </span>
          <span className="flex items-center gap-1.5 text-xs text-yellow-400">
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />{recent} recently active
          </span>
        </div>

        <div className="space-y-2">
          {users.map((u) => (
            <button
              key={u.id}
              onClick={() => openDetail(u.id)}
              className={`w-full text-left rounded-xl border p-4 transition-colors ${
                selected === u.id
                  ? "border-orange-500/50 bg-zinc-800"
                  : "border-zinc-800 bg-zinc-900 hover:bg-zinc-800/60"
              } ${u.deleted_at ? "opacity-40" : ""}`}
            >
              <div className="flex items-center gap-3">
                <div className="relative flex-shrink-0">
                  <div className="w-9 h-9 rounded-full bg-zinc-700 flex items-center justify-center text-sm font-semibold text-zinc-300">
                    {(u.full_name?.[0] || u.email[0]).toUpperCase()}
                  </div>
                  <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-zinc-900 ${STATUS_DOT[u.status]}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white truncate">{u.full_name || u.email}</span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${ROLE_BADGE[u.role] ?? ROLE_BADGE.member}`}>{u.role}</span>
                    {u.deleted_at && <span className="text-[10px] text-red-400">deleted</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="text-xs text-zinc-500 truncate">{u.email}</span>
                    {u.last_seen_at && (
                      <span className="text-[10px] text-zinc-600">{STATUS_LABEL[u.status]} · {rel(u.last_seen_at)}</span>
                    )}
                    {u.last_pathname && (
                      <span className="text-[10px] text-zinc-600 font-mono truncate max-w-[160px]">{u.last_pathname}</span>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  {u.errors_7d > 0 && (
                    <span className="inline-block text-[10px] font-semibold bg-red-500/15 text-red-400 px-2 py-0.5 rounded-full">
                      {u.errors_7d} error{u.errors_7d !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="w-[480px] flex-shrink-0">
          <div className="sticky top-20">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden max-h-[calc(100vh-120px)] flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 flex-shrink-0">
                <span className="text-sm font-semibold text-white">User Detail</span>
                <button onClick={() => setSelected(null)} className="text-zinc-600 hover:text-zinc-300 text-lg leading-none">×</button>
              </div>
              <div className="overflow-y-auto flex-1 p-4">
                {detailLoading && <div className="h-40 animate-pulse bg-zinc-800 rounded-lg" />}
                {detail && <UserDetailView detail={detail} />}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function UserDetailView({ detail }: { detail: UserDetail }) {
  const { profile, timeline } = detail
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const kindIcon: Record<string, string> = {
    session: "🔐",
    error: "🔴",
    network: "🌐",
    page_view: "📄",
  }

  const kindLabel: Record<string, string> = {
    session: "Session",
    error: "Error",
    network: "Network",
    page_view: "Page view",
  }

  const kindColor: Record<string, string> = {
    session: "border-blue-800/50 bg-blue-950/30",
    error: "border-red-800/50 bg-red-950/30",
    network: "border-orange-800/50 bg-orange-950/30",
    page_view: "border-zinc-800 bg-zinc-800/30",
  }

  return (
    <div className="space-y-4">
      {/* Profile header */}
      <div className="flex items-center gap-3 pb-3 border-b border-zinc-800">
        <div className="w-10 h-10 rounded-full bg-zinc-700 flex items-center justify-center text-base font-semibold text-zinc-300">
          {(profile.full_name?.[0] || profile.email[0]).toUpperCase()}
        </div>
        <div>
          <p className="text-sm font-semibold text-white">{profile.full_name || profile.email}</p>
          <p className="text-xs text-zinc-500">{profile.email} · {profile.role}</p>
        </div>
        <div className="ml-auto">
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-full ${
            profile.status === "online" ? "bg-emerald-500/15 text-emerald-400" :
            profile.status === "recent" ? "bg-yellow-500/15 text-yellow-400" :
            "bg-zinc-800 text-zinc-500"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[profile.status]}`} />
            {STATUS_LABEL[profile.status]}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-zinc-800 p-2 text-center">
          <p className="text-lg font-bold text-white">{detail.errors.length}</p>
          <p className="text-[10px] text-zinc-500">Errors</p>
        </div>
        <div className="rounded-lg bg-zinc-800 p-2 text-center">
          <p className="text-lg font-bold text-white">{detail.network_errors.length}</p>
          <p className="text-[10px] text-zinc-500">Net issues</p>
        </div>
        <div className="rounded-lg bg-zinc-800 p-2 text-center">
          <p className="text-lg font-bold text-white">{detail.page_views.length}</p>
          <p className="text-[10px] text-zinc-500">Page views</p>
        </div>
      </div>

      {/* Unified timeline */}
      <div>
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Timeline</p>
        <div className="space-y-1.5">
          {timeline.length === 0 && (
            <p className="text-xs text-zinc-600 py-3 text-center">No activity recorded yet</p>
          )}
          {timeline.map((entry, i) => {
            const id = `${entry.kind}-${i}`
            const isOpen = expandedId === id
            const d = entry.data

            return (
              <div key={id} className={`rounded-lg border text-xs overflow-hidden ${kindColor[entry.kind]}`}>
                <button
                  className="w-full text-left px-3 py-2 flex items-center gap-2"
                  onClick={() => setExpandedId(isOpen ? null : id)}
                >
                  <span>{kindIcon[entry.kind]}</span>
                  <span className="text-zinc-500 text-[10px]">{kindLabel[entry.kind]}</span>
                  <span className="flex-1 text-zinc-300 truncate font-mono">
                    {entry.kind === "session" && `${d.event_type}`}
                    {entry.kind === "error" && d.error_message?.slice(0, 80)}
                    {entry.kind === "network" && `${d.method} ${d.path?.slice(0, 60)} → ${d.status_code}`}
                    {entry.kind === "page_view" && d.pathname}
                  </span>
                  <span className="text-zinc-600 text-[10px] whitespace-nowrap">{rel(entry.at)}</span>
                  <span className="text-zinc-600 ml-1">{isOpen ? "▲" : "▼"}</span>
                </button>

                {isOpen && (
                  <div className="px-3 pb-3 space-y-2 border-t border-zinc-700/40 pt-2">
                    {/* Error detail */}
                    {entry.kind === "error" && (
                      <>
                        <div className="flex gap-2 flex-wrap">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${severityColor(d.severity)}`}>{d.severity}</span>
                          <span className="text-[10px] bg-zinc-700 text-zinc-400 px-1.5 py-0.5 rounded-full">{d.source}</span>
                        </div>
                        <p className="text-zinc-300 font-mono text-[11px] break-words">{d.error_message}</p>
                        {d.stack_trace && (
                          <pre className="text-[10px] text-zinc-500 overflow-x-auto whitespace-pre-wrap max-h-32 font-mono bg-zinc-900 rounded p-2">{d.stack_trace}</pre>
                        )}
                        {d.context && Object.keys(d.context).length > 0 && (
                          <div>
                            <p className="text-[10px] text-zinc-600 mb-1">Context</p>
                            <pre className="text-[10px] text-zinc-500 font-mono bg-zinc-900 rounded p-2 overflow-x-auto">{JSON.stringify(d.context, null, 2).slice(0, 800)}</pre>
                          </div>
                        )}
                      </>
                    )}

                    {/* Network detail */}
                    {entry.kind === "network" && (
                      <>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
                          <span className="text-zinc-600">Method</span><span className="text-zinc-300 font-mono">{d.method}</span>
                          <span className="text-zinc-600">Status</span><span className={`font-semibold ${statusColor(d.status_code)}`}>{d.status_code ?? "—"}</span>
                          <span className="text-zinc-600">Latency</span><span className="text-zinc-300">{d.duration_ms != null ? `${d.duration_ms}ms` : "—"}</span>
                          <span className="text-zinc-600">Path</span><span className="text-zinc-300 font-mono truncate">{d.path}</span>
                        </div>
                        {d.metadata?.request_headers && Object.keys(d.metadata.request_headers as object).length > 0 && (
                          <div>
                            <p className="text-[10px] text-zinc-600 mb-1">Request Headers</p>
                            <pre className="text-[10px] text-zinc-500 font-mono bg-zinc-900 rounded p-2 overflow-x-auto max-h-24">{JSON.stringify(d.metadata.request_headers, null, 2)}</pre>
                          </div>
                        )}
                        {d.metadata?.request_body_preview && (
                          <div>
                            <p className="text-[10px] text-zinc-600 mb-1">Request Body</p>
                            <pre className="text-[10px] text-zinc-500 font-mono bg-zinc-900 rounded p-2 overflow-x-auto max-h-24">{d.metadata.request_body_preview as string}</pre>
                          </div>
                        )}
                        {d.metadata?.response_headers && Object.keys(d.metadata.response_headers as object).length > 0 && (
                          <div>
                            <p className="text-[10px] text-zinc-600 mb-1">Response Headers</p>
                            <pre className="text-[10px] text-zinc-500 font-mono bg-zinc-900 rounded p-2 overflow-x-auto max-h-24">{JSON.stringify(d.metadata.response_headers, null, 2)}</pre>
                          </div>
                        )}
                        {d.metadata?.response_preview && (
                          <div>
                            <p className="text-[10px] text-zinc-600 mb-1">Response Preview</p>
                            <pre className="text-[10px] text-zinc-500 font-mono bg-zinc-900 rounded p-2 overflow-x-auto max-h-32 break-words whitespace-pre-wrap">{d.metadata.response_preview as string}</pre>
                          </div>
                        )}
                      </>
                    )}

                    {/* Session detail */}
                    {entry.kind === "session" && (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
                        <span className="text-zinc-600">Event</span><span className="text-zinc-300">{d.event_type}</span>
                        <span className="text-zinc-600">IP</span><span className="text-zinc-300 font-mono">{d.ip_address || "—"}</span>
                        {d.metadata?.screen && <><span className="text-zinc-600">Screen</span><span className="text-zinc-300">{d.metadata.screen as string}</span></>}
                        {d.metadata?.timezone && <><span className="text-zinc-600">TZ</span><span className="text-zinc-300">{d.metadata.timezone as string}</span></>}
                        {d.metadata?.language && <><span className="text-zinc-600">Language</span><span className="text-zinc-300">{d.metadata.language as string}</span></>}
                      </div>
                    )}

                    {/* Page view detail */}
                    {entry.kind === "page_view" && (
                      <div className="text-[10px] text-zinc-500 font-mono">{d.pathname}</div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
