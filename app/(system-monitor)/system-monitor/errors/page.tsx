import { requireRole } from "@/lib/auth"
import { listErrorLogs, resolveErrorLog } from "@/lib/system"
import { PageHeader } from "@/components/dashboard/page-header"
import { ErrorLogsTable } from "@/components/dashboard/system/error-logs-table"
import { revalidatePath } from "next/cache"

interface PageProps {
  searchParams: Promise<{
    severity?: string
    source?: string
    unresolved?: string
    since?: string
    page?: string
    fingerprint?: string
  }>
}

const LIMIT = 50

async function handleResolve(id: string) {
  "use server"
  await resolveErrorLog(id)
  revalidatePath("/system-monitor/errors")
}

export default async function ErrorLogsPage({ searchParams }: PageProps) {
  await requireRole(["main_admin"])
  const sp = await searchParams

  const page = Math.max(1, parseInt(sp.page ?? "1", 10))
  const offset = (page - 1) * LIMIT

  const { rows, total } = await listErrorLogs({
    severity: sp.severity as any,
    source: sp.source,
    unresolvedOnly: sp.unresolved === "1",
    since: sp.since,
    fingerprint: sp.fingerprint,
    limit: LIMIT,
    offset,
  })

  return (
    <>
      <PageHeader
        title="Error Logs"
        description="Structured error events with severity, source, stack traces, context, and issue grouping."
      />

      {/* Filters */}
      <form method="GET" className="flex flex-wrap gap-2">
        <select
          name="severity"
          defaultValue={sp.severity ?? ""}
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">All severities</option>
          <option value="error">Error</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>

        <select
          name="source"
          defaultValue={sp.source ?? ""}
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">All sources</option>
          <option value="api">API</option>
          <option value="server">Server</option>
          <option value="cron">Cron</option>
          <option value="pipeline">Pipeline</option>
          <option value="ai">AI</option>
          <option value="client">Client</option>
        </select>

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

        <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-[13px] cursor-pointer hover:bg-muted/50 transition-colors">
          <input
            type="checkbox"
            name="unresolved"
            value="1"
            defaultChecked={sp.unresolved === "1"}
            className="rounded"
          />
          Unresolved only
        </label>

        <button
          type="submit"
          className="rounded-lg bg-foreground text-background px-3 py-1.5 text-[13px] font-medium hover:bg-foreground/90 transition-colors"
        >
          Apply
        </button>
        <a
          href="/system-monitor/errors"
          className="rounded-lg border border-border px-3 py-1.5 text-[13px] hover:bg-muted/50 transition-colors"
        >
          Reset
        </a>
      </form>

      <ErrorLogsTable rows={rows} total={total} onResolve={handleResolve} />

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
