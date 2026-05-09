import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SystemRequestLog {
  id: string
  trace_id: string | null
  method: string
  path: string
  status_code: number | null
  duration_ms: number | null
  user_id: string | null
  ip_address: string | null
  user_agent: string | null
  error_message: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface SystemErrorLog {
  id: string
  trace_id: string | null
  severity: "error" | "warning" | "info"
  source: string
  error_message: string
  error_code: string | null
  stack_trace: string | null
  path: string | null
  method: string | null
  user_id: string | null
  fingerprint: string | null
  context: Record<string, unknown>
  resolved_at: string | null
  created_at: string
}

export interface SystemHealthSummary {
  requests_24h: number
  errors_24h: number
  avg_latency_ms_24h: number | null
  error_events_24h: number
  unresolved_errors_24h: number
  ai_calls_24h: number
}

export interface RequestVolumePoint {
  hour: string
  total: number
  errors: number
}

export interface TopPath {
  path: string
  count: number
  avg_ms: number | null
  error_count: number
}

// ---------------------------------------------------------------------------
// Health Summary
// ---------------------------------------------------------------------------

export async function getSystemHealthSummary(): Promise<SystemHealthSummary> {
  const admin = createAdminClient()
  const now = new Date()
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()

  const EMPTY: SystemHealthSummary = {
    requests_24h: 0,
    errors_24h: 0,
    avg_latency_ms_24h: null,
    error_events_24h: 0,
    unresolved_errors_24h: 0,
    ai_calls_24h: 0,
  }

  const [reqResult, errResult, aiResult] = await Promise.all([
    admin
      .from("system_request_logs")
      .select("status_code, duration_ms", { count: "exact" })
      .gte("created_at", since) as any,
    admin
      .from("system_error_logs")
      .select("resolved_at", { count: "exact" })
      .gte("created_at", since) as any,
    admin
      .from("ai_usage_log")
      .select("id", { count: "exact" })
      .gte("created_at", since) as any,
  ])

  if (reqResult.error || errResult.error) return EMPTY

  const rows: { status_code: number | null; duration_ms: number | null }[] =
    reqResult.data ?? []
  const errorRows: { resolved_at: string | null }[] = errResult.data ?? []

  const requests_24h = reqResult.count ?? 0
  const errors_24h = rows.filter((r) => (r.status_code ?? 0) >= 400).length
  const latencies = rows.map((r) => r.duration_ms).filter((v): v is number => v !== null)
  const avg_latency_ms_24h =
    latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null

  return {
    requests_24h,
    errors_24h,
    avg_latency_ms_24h,
    error_events_24h: errResult.count ?? 0,
    unresolved_errors_24h: errorRows.filter((r) => r.resolved_at === null).length,
    ai_calls_24h: aiResult.count ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Request logs list (paginated)
// ---------------------------------------------------------------------------

export interface RequestLogsFilter {
  method?: string
  minStatus?: number
  maxStatus?: number
  pathContains?: string
  since?: string
  limit?: number
  offset?: number
}

export async function listRequestLogs(filter: RequestLogsFilter = {}): Promise<{
  rows: SystemRequestLog[]
  total: number
}> {
  const admin = createAdminClient()
  const limit = filter.limit ?? 50
  const offset = filter.offset ?? 0

  let q = (admin.from("system_request_logs") as any)
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  if (filter.method) q = q.eq("method", filter.method.toUpperCase())
  if (filter.minStatus) q = q.gte("status_code", filter.minStatus)
  if (filter.maxStatus) q = q.lte("status_code", filter.maxStatus)
  if (filter.pathContains) q = q.ilike("path", `%${filter.pathContains}%`)
  if (filter.since) q = q.gte("created_at", filter.since)

  const { data, count, error } = await q
  if (error) return { rows: [], total: 0 }

  return { rows: (data as SystemRequestLog[]) ?? [], total: count ?? 0 }
}

// ---------------------------------------------------------------------------
// Error logs list (paginated)
// ---------------------------------------------------------------------------

export interface ErrorLogsFilter {
  severity?: "error" | "warning" | "info"
  source?: string
  unresolvedOnly?: boolean
  since?: string
  fingerprint?: string
  limit?: number
  offset?: number
}

export async function listErrorLogs(filter: ErrorLogsFilter = {}): Promise<{
  rows: SystemErrorLog[]
  total: number
}> {
  const admin = createAdminClient()
  const limit = filter.limit ?? 50
  const offset = filter.offset ?? 0

  let q = (admin.from("system_error_logs") as any)
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  if (filter.severity) q = q.eq("severity", filter.severity)
  if (filter.source) q = q.eq("source", filter.source)
  if (filter.unresolvedOnly) q = q.is("resolved_at", null)
  if (filter.since) q = q.gte("created_at", filter.since)
  if (filter.fingerprint) q = q.eq("fingerprint", filter.fingerprint)

  const { data, count, error } = await q
  if (error) return { rows: [], total: 0 }

  return { rows: (data as SystemErrorLog[]) ?? [], total: count ?? 0 }
}

// ---------------------------------------------------------------------------
// Hourly request volume for the last 24h (for charts)
// ---------------------------------------------------------------------------

export async function getRequestVolumeByHour(): Promise<RequestVolumePoint[]> {
  const admin = createAdminClient()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const buckets: Record<string, { total: number; errors: number }> = {}
  for (let i = 23; i >= 0; i--) {
    const d = new Date(Date.now() - i * 60 * 60 * 1000)
    const key = `${d.getUTCHours().toString().padStart(2, "0")}:00`
    buckets[key] = { total: 0, errors: 0 }
  }

  const { data, error } = await (admin.from("system_request_logs") as any)
    .select("created_at, status_code")
    .gte("created_at", since)
    .order("created_at", { ascending: true })

  if (error) return Object.entries(buckets).map(([hour]) => ({ hour, total: 0, errors: 0 }))

  for (const row of data ?? []) {
    const h = new Date(row.created_at).getUTCHours()
    const key = `${h.toString().padStart(2, "0")}:00`
    if (buckets[key]) {
      buckets[key].total++
      if ((row.status_code ?? 0) >= 400) buckets[key].errors++
    }
  }

  return Object.entries(buckets).map(([hour, v]) => ({ hour, ...v }))
}

// ---------------------------------------------------------------------------
// Top paths by request count
// ---------------------------------------------------------------------------

export async function getTopPaths(limit = 10): Promise<TopPath[]> {
  const admin = createAdminClient()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await (admin.from("system_request_logs") as any)
    .select("path, status_code, duration_ms")
    .gte("created_at", since)

  if (error) return []

  const map: Record<string, { count: number; latencies: number[]; errors: number }> = {}

  for (const row of data ?? []) {
    if (!map[row.path]) map[row.path] = { count: 0, latencies: [], errors: 0 }
    map[row.path].count++
    if (row.duration_ms !== null) map[row.path].latencies.push(row.duration_ms)
    if ((row.status_code ?? 0) >= 400) map[row.path].errors++
  }

  return Object.entries(map)
    .map(([path, v]) => ({
      path,
      count: v.count,
      avg_ms:
        v.latencies.length > 0
          ? Math.round(v.latencies.reduce((a, b) => a + b, 0) / v.latencies.length)
          : null,
      error_count: v.errors,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

// ---------------------------------------------------------------------------
// Resolve an error log
// ---------------------------------------------------------------------------

export async function resolveErrorLog(id: string): Promise<void> {
  const admin = createAdminClient()
  const { error } = await (admin.from("system_error_logs") as any)
    .update({ resolved_at: new Date().toISOString() })
    .eq("id", id)
  if (error) console.error("[system] resolveErrorLog failed", error.message)
}

// ---------------------------------------------------------------------------
// Error groups — issue list grouped by fingerprint
// ---------------------------------------------------------------------------

export interface ErrorGroup {
  fingerprint: string
  error_message: string
  source: string
  severity: "error" | "warning" | "info"
  occurrences: number
  affected_users: number
  first_seen: string
  last_seen: string
  resolved: boolean
  sample_id: string
  sample_path: string | null
}

export async function getErrorGroups(since?: string): Promise<ErrorGroup[]> {
  const admin = createAdminClient()
  const cutoff = since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await (admin.from("system_error_logs") as any)
    .select("id, fingerprint, error_message, source, severity, user_id, resolved_at, created_at, path")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(2000)

  if (error) return []

  const map: Record<string, {
    error_message: string
    source: string
    severity: "error" | "warning" | "info"
    count: number
    users: Set<string>
    first_seen: string
    last_seen: string
    any_unresolved: boolean
    sample_id: string
    sample_path: string | null
  }> = {}

  for (const row of data ?? []) {
    const key = row.fingerprint ?? row.error_message.slice(0, 80)
    if (!map[key]) {
      map[key] = {
        error_message: row.error_message,
        source: row.source,
        severity: row.severity,
        count: 0,
        users: new Set(),
        first_seen: row.created_at,
        last_seen: row.created_at,
        any_unresolved: false,
        sample_id: row.id,
        sample_path: row.path,
      }
    }
    const g = map[key]
    g.count++
    if (row.user_id) g.users.add(row.user_id)
    if (row.created_at < g.first_seen) g.first_seen = row.created_at
    if (row.created_at > g.last_seen) g.last_seen = row.created_at
    if (!row.resolved_at) g.any_unresolved = true
  }

  return Object.entries(map)
    .map(([fingerprint, g]) => ({
      fingerprint,
      error_message: g.error_message,
      source: g.source,
      severity: g.severity,
      occurrences: g.count,
      affected_users: g.users.size,
      first_seen: g.first_seen,
      last_seen: g.last_seen,
      resolved: !g.any_unresolved,
      sample_id: g.sample_id,
      sample_path: g.sample_path,
    }))
    .sort((a, b) => b.occurrences - a.occurrences)
}

// ---------------------------------------------------------------------------
// Performance metrics — p50 / p95 / p99 per path
// ---------------------------------------------------------------------------

export interface PathPerformance {
  path: string
  count: number
  p50: number
  p95: number
  p99: number
  max: number
  error_rate: number
}

export async function getPerformanceMetrics(since?: string): Promise<PathPerformance[]> {
  const admin = createAdminClient()
  const cutoff = since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await (admin.from("system_request_logs") as any)
    .select("path, duration_ms, status_code")
    .gte("created_at", cutoff)
    .not("duration_ms", "is", null)
    .limit(5000)

  if (error) return []

  const map: Record<string, { latencies: number[]; errors: number }> = {}

  for (const row of data ?? []) {
    if (!map[row.path]) map[row.path] = { latencies: [], errors: 0 }
    map[row.path].latencies.push(row.duration_ms)
    if ((row.status_code ?? 0) >= 400) map[row.path].errors++
  }

  function percentile(arr: number[], p: number): number {
    const sorted = [...arr].sort((a, b) => a - b)
    const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
    return sorted[idx] ?? 0
  }

  return Object.entries(map)
    .filter(([, v]) => v.latencies.length >= 3)
    .map(([path, v]) => ({
      path,
      count: v.latencies.length,
      p50: percentile(v.latencies, 50),
      p95: percentile(v.latencies, 95),
      p99: percentile(v.latencies, 99),
      max: Math.max(...v.latencies),
      error_rate: v.errors / v.latencies.length,
    }))
    .sort((a, b) => b.p95 - a.p95)
}

// ---------------------------------------------------------------------------
// Error trend — hourly breakdown of error severity over 24h (for charts)
// ---------------------------------------------------------------------------

export interface ErrorTrendPoint {
  hour: string
  error: number
  warning: number
  info: number
}

export async function getErrorTrend(): Promise<ErrorTrendPoint[]> {
  const admin = createAdminClient()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const buckets: Record<string, ErrorTrendPoint> = {}
  for (let i = 23; i >= 0; i--) {
    const h = new Date(Date.now() - i * 60 * 60 * 1000).getUTCHours()
    const key = `${h.toString().padStart(2, "0")}:00`
    buckets[key] = { hour: key, error: 0, warning: 0, info: 0 }
  }

  const { data, error } = await (admin.from("system_error_logs") as any)
    .select("created_at, severity")
    .gte("created_at", since)

  if (error) return Object.values(buckets)

  for (const row of data ?? []) {
    const key = `${new Date(row.created_at).getUTCHours().toString().padStart(2, "0")}:00`
    if (buckets[key]) buckets[key][row.severity as "error" | "warning" | "info"]++
  }

  return Object.values(buckets)
}

// ---------------------------------------------------------------------------
// Status code breakdown (for doughnut / bar chart)
// ---------------------------------------------------------------------------

export interface StatusBreakdown {
  label: string
  count: number
  color: string
}

export async function getStatusBreakdown(): Promise<StatusBreakdown[]> {
  const admin = createAdminClient()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await (admin.from("system_request_logs") as any)
    .select("status_code")
    .gte("created_at", since)

  if (error) return []

  const buckets: Record<string, number> = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 }
  for (const row of data ?? []) {
    const s = row.status_code ?? 0
    if (s >= 500) buckets["5xx"]++
    else if (s >= 400) buckets["4xx"]++
    else if (s >= 300) buckets["3xx"]++
    else if (s >= 200) buckets["2xx"]++
  }

  const colors: Record<string, string> = {
    "2xx": "#10b981",
    "3xx": "#6366f1",
    "4xx": "#f59e0b",
    "5xx": "#ef4444",
  }

  return Object.entries(buckets)
    .filter(([, count]) => count > 0)
    .map(([label, count]) => ({ label, count, color: colors[label] }))
}
