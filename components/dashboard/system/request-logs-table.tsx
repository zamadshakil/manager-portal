"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDistanceToNow } from "date-fns"
import type { SystemRequestLog } from "@/lib/system"

interface RequestLogsTableProps {
  rows: SystemRequestLog[]
  total: number
}

const METHOD_COLORS: Record<string, string> = {
  GET: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  POST: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  PUT: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  PATCH: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  DELETE: "bg-red-500/15 text-red-600 dark:text-red-400",
}

function statusBadge(code: number | null) {
  if (code === null) return <span className="text-muted-foreground">—</span>
  const cls =
    code < 300
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      : code < 400
        ? "bg-blue-500/15 text-blue-500"
        : code < 500
          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
          : "bg-red-500/15 text-red-500"
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums", cls)}>
      {code}
    </span>
  )
}

function RowDetail({ row }: { row: SystemRequestLog }) {
  return (
    <div className="px-4 pb-4 pt-1 text-[12px] space-y-2 bg-muted/30 border-t border-border">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {row.trace_id && (
          <div>
            <span className="text-muted-foreground">Trace ID</span>
            <code className="block mt-0.5 truncate text-foreground/80">{row.trace_id}</code>
          </div>
        )}
        {row.ip_address && (
          <div>
            <span className="text-muted-foreground">IP</span>
            <code className="block mt-0.5">{row.ip_address}</code>
          </div>
        )}
        {row.user_id && (
          <div>
            <span className="text-muted-foreground">User ID</span>
            <code className="block mt-0.5 truncate">{row.user_id}</code>
          </div>
        )}
        {row.user_agent && (
          <div className="col-span-2 sm:col-span-3">
            <span className="text-muted-foreground">User Agent</span>
            <p className="mt-0.5 text-foreground/80 break-all">{row.user_agent}</p>
          </div>
        )}
        {row.error_message && (
          <div className="col-span-2 sm:col-span-3">
            <span className="text-red-500 font-medium">Error</span>
            <p className="mt-0.5 text-red-600 dark:text-red-400">{row.error_message}</p>
          </div>
        )}
      </div>
    </div>
  )
}

export function RequestLogsTable({ rows, total }: RequestLogsTableProps) {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (rows.length === 0) {
    return (
      <div className="py-16 text-center text-[13px] text-muted-foreground">
        No request logs yet. Wrap API routes with <code>withRequestLog()</code> to start
        collecting.
      </div>
    )
  }

  return (
    <div>
      <p className="mb-3 text-[12px] text-muted-foreground">
        Showing {rows.length} of {total.toLocaleString()} logs
      </p>
      <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
        {/* Header */}
        <div className="grid grid-cols-[80px_1fr_64px_72px_100px] gap-3 px-4 py-2.5 bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span>Method</span>
          <span>Path</span>
          <span>Status</span>
          <span>Latency</span>
          <span>Time</span>
        </div>

        {rows.map((row) => {
          const isExpanded = expanded === row.id
          const isError = (row.status_code ?? 0) >= 400
          return (
            <div key={row.id}>
              <button
                type="button"
                onClick={() => setExpanded(isExpanded ? null : row.id)}
                className={cn(
                  "grid grid-cols-[80px_1fr_64px_72px_100px] gap-3 w-full px-4 py-3 text-left hover:bg-muted/30 transition-colors items-center",
                  isError && "bg-red-500/5",
                )}
              >
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[11px] font-semibold w-fit",
                    METHOD_COLORS[row.method] ?? "bg-muted text-foreground",
                  )}
                >
                  {row.method}
                </span>
                <div className="flex items-center gap-1.5 min-w-0">
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <code className="text-[12px] truncate">{row.path}</code>
                </div>
                <span>{statusBadge(row.status_code)}</span>
                <span className="text-[12px] tabular-nums text-muted-foreground">
                  {row.duration_ms !== null ? `${row.duration_ms}ms` : "—"}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
                </span>
              </button>
              {isExpanded && <RowDetail row={row} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
