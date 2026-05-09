import { requireRole } from "@/lib/auth"
import { getErrorGroups } from "@/lib/system"
import { PageHeader } from "@/components/dashboard/page-header"
import { ErrorGroupsTable } from "@/components/dashboard/system/error-groups-table"

interface PageProps {
  searchParams: Promise<{ since?: string; resolved?: string }>
}

export default async function IssuesPage({ searchParams }: PageProps) {
  await requireRole(["main_admin"])
  const sp = await searchParams

  const since7d = new Date(Date.now() - 7 * 86400000).toISOString()
  const since30d = new Date(Date.now() - 30 * 86400000).toISOString()

  const since = sp.since === "30d" ? since30d : since7d

  const groups = await getErrorGroups(since)

  const open = groups.filter((g) => !g.resolved)
  const resolved = groups.filter((g) => g.resolved)
  const visible = sp.resolved === "1" ? resolved : open

  return (
    <>
      <PageHeader
        title="Issues"
        description="Errors grouped by fingerprint — same error across different requests counts as one issue."
      />

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <form method="GET" className="flex items-center gap-2">
          <select
            name="since"
            defaultValue={sp.since ?? "7d"}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>

          <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-[13px] cursor-pointer hover:bg-muted/50 transition-colors">
            <input
              type="checkbox"
              name="resolved"
              value="1"
              defaultChecked={sp.resolved === "1"}
              className="rounded"
            />
            Show resolved
          </label>

          <button
            type="submit"
            className="rounded-lg bg-foreground text-background px-3 py-1.5 text-[13px] font-medium hover:bg-foreground/90 transition-colors"
          >
            Apply
          </button>
        </form>

        <div className="ml-auto flex items-center gap-3 text-[12px] text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground">{open.length}</span> open
          </span>
          <span>
            <span className="font-semibold text-foreground">{resolved.length}</span> resolved
          </span>
          <span>
            <span className="font-semibold text-foreground">
              {groups.reduce((s, g) => s + g.occurrences, 0).toLocaleString()}
            </span>{" "}
            total events
          </span>
        </div>
      </div>

      <ErrorGroupsTable groups={visible} />
    </>
  )
}
