import { cn } from "@/lib/utils"
import type { TopPath } from "@/lib/system"

interface TopPathsTableProps {
  paths: TopPath[]
}

export function TopPathsTable({ paths }: TopPathsTableProps) {
  if (paths.length === 0) {
    return (
      <p className="py-8 text-center text-[13px] text-muted-foreground">
        No request data yet
      </p>
    )
  }

  const maxCount = paths[0]?.count ?? 1

  return (
    <div className="space-y-2">
      {paths.map((p) => {
        const errPct = p.count > 0 ? (p.error_count / p.count) * 100 : 0
        const barWidth = Math.round((p.count / maxCount) * 100)
        return (
          <div key={p.path} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-[12px]">
              <code className="truncate text-foreground/80 max-w-[60%]">{p.path}</code>
              <div className="flex items-center gap-3 shrink-0 text-muted-foreground">
                <span>{p.count.toLocaleString()} req</span>
                {p.avg_ms !== null && <span>{p.avg_ms}ms</span>}
                {p.error_count > 0 && (
                  <span className="text-red-500">{errPct.toFixed(0)}% err</span>
                )}
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  errPct > 10 ? "bg-red-500" : errPct > 0 ? "bg-amber-500" : "bg-indigo-500",
                )}
                style={{ width: `${barWidth}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
