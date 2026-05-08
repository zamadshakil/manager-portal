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
  sentry_event_id: string | null
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
  if (error) throw new Error(`listRequestLogs: ${error.message}`)

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

  const { data, count, error } = await q
  if (error) throw new Error(`listErrorLogs: ${error.message}`)

  return { rows: (data as SystemErrorLog[]) ?? [], total: count ?? 0 }
}

// ---------------------------------------------------------------------------
// Hourly request volume for the last 24h (for charts)
// ---------------------------------------------------------------------------

export async function getRequestVolumeByHour(): Promise<RequestVolumePoint[]> {
  const admin = createAdminClient()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await (admin.from("system_request_logs") as any)
    .select("created_at, status_code")
    .gte("created_at", since)
    .order("created_at", { ascending: true })

  if (error) throw new Error(`getRequestVolumeByHour: ${error.message}`)

  const buckets: Record<string, { total: number; errors: number }> = {}

  for (let i = 23; i >= 0; i--) {
    const d = new Date(Date.now() - i * 60 * 60 * 1000)
    const key = `${d.getUTCHours().toString().padStart(2, "0")}:00`
    buckets[key] = { total: 0, errors: 0 }
  }

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

  if (error) throw new Error(`getTopPaths: ${error.message}`)

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
  if (error) throw new Error(`resolveErrorLog: ${error.message}`)
}
