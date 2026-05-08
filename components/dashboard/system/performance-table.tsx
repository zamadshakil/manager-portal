import { cn } from "@/lib/utils"
import type { PathPerformance } from "@/lib/system"

interface PerformanceTableProps {
  data: PathPerformance[]
}

function LatencyBadge({ ms }: { ms: number }) {
  const cls =
    ms > 2000
      ? "bg-red-500/15 text-red-600 dark:text-red-400"
      : ms > 800
        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
        : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums", cls)}>
      {ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`}
    </span>
  )
}

export function PerformanceTable({ data }: PerformanceTableProps) {
  if (data.length === 0) {
    return (
      <div className="py-16 text-center text-[13px] text-muted-foreground">
        No performance data yet — wrap routes with <code>withRequestLog()</code>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="grid grid-cols-[1fr_64px_80px_80px_80px_80px_80px] gap-3 px-4 py-2.5 bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>Endpoint</span>
        <span>Calls</span>
        <span>p50</span>
        <span>p95</span>
        <span>p99</span>
        <span>Max</span>
        <span>Err%</span>
      </div>
      <div className="divide-y divide-border">
        {data.map((row) => (
          <div
            key={row.path}
            className="grid grid-cols-[1fr_64px_80px_80px_80px_80px_80px] gap-3 px-4 py-3 items-center"
          >
            <code className="text-[12px] truncate">{row.path}</code>
            <span className="text-[12px] tabular-nums text-muted-foreground">{row.count}</span>
            <LatencyBadge ms={row.p50} />
            <LatencyBadge ms={row.p95} />
            <LatencyBadge ms={row.p99} />
            <span className="text-[12px] tabular-nums text-muted-foreground">
              {row.max < 1000 ? `${row.max}ms` : `${(row.max / 1000).toFixed(2)}s`}
            </span>
            <span
              className={cn(
                "text-[12px] tabular-nums font-medium",
                row.error_rate > 0.1
                  ? "text-red-500"
                  : row.error_rate > 0
                    ? "text-amber-500"
                    : "text-muted-foreground",
              )}
            >
              {(row.error_rate * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
