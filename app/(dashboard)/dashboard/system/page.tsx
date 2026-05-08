import { Suspense } from "react"
import Link from "next/link"
import { requireRole } from "@/lib/auth"
import {
  getSystemHealthSummary,
  getRequestVolumeByHour,
  getTopPaths,
  listErrorLogs,
  getErrorTrend,
  getStatusBreakdown,
  getErrorGroups,
} from "@/lib/system"
import { PageHeader } from "@/components/dashboard/page-header"
import { HealthStats } from "@/components/dashboard/system/health-stats"
import { RequestChart } from "@/components/dashboard/system/request-chart"
import { TopPathsTable } from "@/components/dashboard/system/top-paths-table"
import { ErrorLogsTable } from "@/components/dashboard/system/error-logs-table"
import { ErrorTrendChart } from "@/components/dashboard/system/error-trend-chart"
import { StatusChart } from "@/components/dashboard/system/status-chart"
import { ErrorGroupsTable } from "@/components/dashboard/system/error-groups-table"

export default async function SystemOverviewPage() {
  await requireRole(["main_admin"])

  return (
    <>
      <PageHeader
        title="System Monitor"
        description="Real-time observability — request logs, error tracking, AI usage, and performance metrics."
        action={
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-[12px] font-semibold text-emerald-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </span>
          </div>
        }
      />

      {/* Health Stats */}
      <Suspense fallback={<StatsSkeleton />}>
        <HealthStatsSection />
      </Suspense>

      {/* Charts + Top Paths */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 lg:gap-6">
        <div className="xl:col-span-2 rounded-xl border border-border bg-card shadow-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[14px] font-semibold">Request Volume (last 24h)</h2>
            <Link
              href="/dashboard/system/requests"
              className="text-[12px] text-muted-foreground hover:text-foreground transition-colors"
            >
              View all →
            </Link>
          </div>
          <Suspense fallback={<ChartSkeleton />}>
            <RequestChartSection />
          </Suspense>
        </div>

        <div className="rounded-xl border border-border bg-card shadow-card p-5">
          <h2 className="text-[14px] font-semibold mb-4">Top Paths (24h)</h2>
          <Suspense fallback={<ListSkeleton />}>
            <TopPathsSection />
          </Suspense>
        </div>
      </div>

      {/* Error Trend + Status Codes */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 lg:gap-6">
        <div className="xl:col-span-2 rounded-xl border border-border bg-card shadow-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[14px] font-semibold">Error Trend (last 24h)</h2>
            <Link
              href="/dashboard/system/errors"
              className="text-[12px] text-muted-foreground hover:text-foreground transition-colors"
            >
              View logs →
            </Link>
          </div>
          <Suspense fallback={<ChartSkeleton />}>
            <ErrorTrendSection />
          </Suspense>
        </div>

        <div className="rounded-xl border border-border bg-card shadow-card p-5">
          <h2 className="text-[14px] font-semibold mb-4">Status Codes (24h)</h2>
          <Suspense fallback={<ChartSkeleton />}>
            <StatusSection />
          </Suspense>
        </div>
      </div>

      {/* Top Issues */}
      <div className="rounded-xl border border-border bg-card shadow-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[14px] font-semibold">Top Issues (7d)</h2>
          <Link
            href="/dashboard/system/issues"
            className="text-[12px] text-muted-foreground hover:text-foreground transition-colors"
          >
            View all →
          </Link>
        </div>
        <Suspense fallback={<ListSkeleton />}>
          <TopIssuesSection />
        </Suspense>
      </div>

      {/* Recent Raw Errors */}
      <div className="rounded-xl border border-border bg-card shadow-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[14px] font-semibold">Recent Errors</h2>
          <Link
            href="/dashboard/system/errors"
            className="text-[12px] text-muted-foreground hover:text-foreground transition-colors"
          >
            View all →
          </Link>
        </div>
        <Suspense fallback={<ListSkeleton />}>
          <RecentErrorsSection />
        </Suspense>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Async sections
// ---------------------------------------------------------------------------

async function HealthStatsSection() {
  const summary = await getSystemHealthSummary()
  return <HealthStats summary={summary} />
}

async function RequestChartSection() {
  const data = await getRequestVolumeByHour()
  return <RequestChart data={data} />
}

async function TopPathsSection() {
  const paths = await getTopPaths(8)
  return <TopPathsTable paths={paths} />
}

async function ErrorTrendSection() {
  const data = await getErrorTrend()
  return <ErrorTrendChart data={data} />
}

async function StatusSection() {
  const [data, summary] = await Promise.all([
    getStatusBreakdown(),
    getSystemHealthSummary(),
  ])
  return <StatusChart data={data} total={summary.requests_24h} />
}

async function TopIssuesSection() {
  const groups = await getErrorGroups()
  return <ErrorGroupsTable groups={groups.filter((g) => !g.resolved).slice(0, 5)} />
}

async function RecentErrorsSection() {
  const { rows, total } = await listErrorLogs({ limit: 5 })
  return <ErrorLogsTable rows={rows} total={total} />
}

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

function StatsSkeleton() {
  return (
    <section
      aria-hidden="true"
      className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 animate-pulse"
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-4 lg:p-5 h-27" />
      ))}
    </section>
  )
}

function ChartSkeleton() {
  return <div aria-hidden="true" className="h-50 rounded-lg bg-muted animate-pulse" />
}

function ListSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-2 animate-pulse">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-8 rounded-md bg-muted" />
      ))}
    </div>
  )
}
