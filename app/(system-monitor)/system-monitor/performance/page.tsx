import { Suspense } from "react"
import { requireRole } from "@/lib/auth"
import {
  getPerformanceMetrics,
  getStatusBreakdown,
  getSystemHealthSummary,
} from "@/lib/system"
import { PageHeader } from "@/components/dashboard/page-header"
import { PerformanceTable } from "@/components/dashboard/system/performance-table"
import { StatusChart } from "@/components/dashboard/system/status-chart"

interface PageProps {
  searchParams: Promise<{ since?: string }>
}

export default async function PerformancePage({ searchParams }: PageProps) {
  await requireRole(["main_admin"])
  const sp = await searchParams

  const sinceOptions: Record<string, string> = {
    "1h": new Date(Date.now() - 1 * 3600000).toISOString(),
    "6h": new Date(Date.now() - 6 * 3600000).toISOString(),
    "24h": new Date(Date.now() - 24 * 3600000).toISOString(),
    "7d": new Date(Date.now() - 7 * 86400000).toISOString(),
  }
  const since = sinceOptions[sp.since ?? "24h"] ?? sinceOptions["24h"]

  return (
    <>
      <PageHeader
        title="Performance"
        description="p50 / p95 / p99 latency per endpoint — identify bottlenecks before users notice."
      />

      {/* Time range picker */}
      <form method="GET" className="flex gap-1">
        {Object.keys(sinceOptions).map((key) => (
          <a
            key={key}
            href={`?since=${key}`}
            className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
              (sp.since ?? "24h") === key
                ? "bg-foreground text-background"
                : "border border-border hover:bg-muted/50"
            }`}
          >
            {key}
          </a>
        ))}
      </form>

      {/* Overview metrics */}
      <Suspense fallback={<MetricsSkeleton />}>
        <OverviewMetrics />
      </Suspense>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 lg:gap-6">
        {/* Endpoint table */}
        <div className="xl:col-span-2 rounded-xl border border-border bg-card shadow-card p-5">
          <h2 className="text-[14px] font-semibold mb-4">
            Endpoint Latency
            <span className="ml-2 text-[12px] font-normal text-muted-foreground">
              sorted by p95 (slowest first)
            </span>
          </h2>
          <Suspense fallback={<TableSkeleton />}>
            <PerformanceSection since={since} />
          </Suspense>
        </div>

        {/* Status code breakdown */}
        <div className="rounded-xl border border-border bg-card shadow-card p-5">
          <h2 className="text-[14px] font-semibold mb-4">Status Codes (24h)</h2>
          <Suspense fallback={<ChartSkeleton />}>
            <StatusSection />
          </Suspense>
        </div>
      </div>
    </>
  )
}

async function OverviewMetrics() {
  const summary = await getSystemHealthSummary()
  const items = [
    {
      label: "Avg Latency",
      value:
        summary.avg_latency_ms_24h !== null
          ? summary.avg_latency_ms_24h < 1000
            ? `${summary.avg_latency_ms_24h}ms`
            : `${(summary.avg_latency_ms_24h / 1000).toFixed(2)}s`
          : "—",
      sub: "24h average",
      warn: (summary.avg_latency_ms_24h ?? 0) > 2000,
    },
    {
      label: "Total Requests",
      value: summary.requests_24h.toLocaleString(),
      sub: "Last 24h",
      warn: false,
    },
    {
      label: "Error Rate",
      value:
        summary.requests_24h > 0
          ? `${((summary.errors_24h / summary.requests_24h) * 100).toFixed(1)}%`
          : "0%",
      sub: `${summary.errors_24h} errors`,
      warn: summary.requests_24h > 0 && summary.errors_24h / summary.requests_24h > 0.05,
    },
  ]
  return (
    <div className="grid grid-cols-3 gap-3 lg:gap-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-xl border border-border bg-card p-4 shadow-card"
        >
          <p className="text-[12px] font-medium text-muted-foreground">{item.label}</p>
          <p
            className={`mt-1 text-[26px] font-semibold tracking-tight ${
              item.warn ? "text-red-500" : ""
            }`}
          >
            {item.value}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{item.sub}</p>
        </div>
      ))}
    </div>
  )
}

async function PerformanceSection({ since }: { since: string }) {
  const data = await getPerformanceMetrics(since)
  return <PerformanceTable data={data} />
}

async function StatusSection() {
  const [breakdown, summary] = await Promise.all([
    getStatusBreakdown(),
    getSystemHealthSummary(),
  ])
  return <StatusChart data={breakdown} total={summary.requests_24h} />
}

function MetricsSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-3 animate-pulse">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-4 h-24" />
      ))}
    </div>
  )
}

function TableSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-10 rounded-md bg-muted" />
      ))}
    </div>
  )
}

function ChartSkeleton() {
  return <div className="h-50 rounded-lg bg-muted animate-pulse" />
}
