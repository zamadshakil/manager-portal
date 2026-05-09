import { requireRole } from "@/lib/auth"
import { listRequestLogs } from "@/lib/system"
import { PageHeader } from "@/components/dashboard/page-header"
import { RequestLogsTable } from "@/components/dashboard/system/request-logs-table"

interface PageProps {
  searchParams: Promise<{
    method?: string
    status?: string
    path?: string
    since?: string
    page?: string
  }>
}

const LIMIT = 50

export default async function RequestLogsPage({ searchParams }: PageProps) {
  await requireRole(["main_admin"])
  const sp = await searchParams

  const page = Math.max(1, parseInt(sp.page ?? "1", 10))
  const offset = (page - 1) * LIMIT

  let minStatus: number | undefined
  let maxStatus: number | undefined
  if (sp.status === "2xx") { minStatus = 200; maxStatus = 299 }
  if (sp.status === "4xx") { minStatus = 400; maxStatus = 499 }
  if (sp.status === "5xx") { minStatus = 500; maxStatus = 599 }

  const { rows, total } = await listRequestLogs({
    method: sp.method,
    minStatus,
    maxStatus,
    pathContains: sp.path,
    since: sp.since,
    limit: LIMIT,
    offset,
  })

  return (
    <>
      <PageHeader
        title="Request Logs"
        description="Every API route call with method, status code, latency, and trace ID."
      />

      {/* Filters */}
      <form method="GET" className="flex flex-wrap gap-2">
        <select
          name="method"
          defaultValue={sp.method ?? ""}
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">All methods</option>
          {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        <select
          name="status"
          defaultValue={sp.status ?? ""}
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">All statuses</option>
          <option value="2xx">2xx Success</option>
          <option value="4xx">4xx Client Error</option>
          <option value="5xx">5xx Server Error</option>
        </select>

        <input
          name="path"
          type="text"
          defaultValue={sp.path ?? ""}
          placeholder="Filter by path…"
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary min-w-50"
        />

        <select
          name="since"
          defaultValue={sp.since ?? ""}
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">All time</option>
          <option value={new Date(Date.now() - 1 * 3600000).toISOString()}>Last 1h</option>
          <option value={new Date(Date.now() - 6 * 3600000).toISOString()}>Last 6h</option>
          <option value={new Date(Date.now() - 24 * 3600000).toISOString()}>Last 24h</option>
          <option value={new Date(Date.now() - 7 * 86400000).toISOString()}>Last 7d</option>
        </select>

        <button
          type="submit"
          className="rounded-lg bg-foreground text-background px-3 py-1.5 text-[13px] font-medium hover:bg-foreground/90 transition-colors"
        >
          Apply
        </button>
        <a
          href="/system-monitor/requests"
          className="rounded-lg border border-border px-3 py-1.5 text-[13px] hover:bg-muted/50 transition-colors"
        >
          Reset
        </a>
      </form>

      <RequestLogsTable rows={rows} total={total} />

      {/* Pagination */}
      {total > LIMIT && (
        <div className="flex items-center justify-between text-[13px] text-muted-foreground">
          <span>
            Page {page} of {Math.ceil(total / LIMIT)}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <a
                href={`?${new URLSearchParams({ ...sp, page: String(page - 1) })}`}
                className="rounded-md border border-border px-3 py-1 hover:bg-muted/50 transition-colors"
              >
                ← Prev
              </a>
            )}
            {page < Math.ceil(total / LIMIT) && (
              <a
                href={`?${new URLSearchParams({ ...sp, page: String(page + 1) })}`}
                className="rounded-md border border-border px-3 py-1 hover:bg-muted/50 transition-colors"
              >
                Next →
              </a>
            )}
          </div>
        </div>
      )}
    </>
  )
}
