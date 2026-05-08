"use client"

import { useState, useTransition } from "react"
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Info,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDistanceToNow } from "date-fns"
import type { SystemErrorLog } from "@/lib/system"

interface ErrorLogsTableProps {
  rows: SystemErrorLog[]
  total: number
  onResolve?: (id: string) => Promise<void>
}

function SeverityBadge({ severity }: { severity: SystemErrorLog["severity"] }) {
  const map = {
    error: {
      icon: AlertCircle,
      cls: "text-red-500 bg-red-500/10",
      label: "Error",
    },
    warning: {
      icon: AlertTriangle,
      cls: "text-amber-500 bg-amber-500/10",
      label: "Warning",
    },
    info: {
      icon: Info,
      cls: "text-blue-500 bg-blue-500/10",
      label: "Info",
    },
  }
  const { icon: Icon, cls, label } = map[severity]
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold",
        cls,
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  )
}

function RowDetail({
  row,
  onResolve,
}: {
  row: SystemErrorLog
  onResolve?: (id: string) => Promise<void>
}) {
  const [pending, startTransition] = useTransition()

  return (
    <div className="px-4 pb-4 pt-2 space-y-3 bg-muted/30 border-t border-border text-[12px]">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {row.trace_id && (
          <div>
            <span className="text-muted-foreground">Trace ID</span>
            <code className="block mt-0.5 truncate text-foreground/80">{row.trace_id}</code>
          </div>
        )}
        <div>
          <span className="text-muted-foreground">Source</span>
          <span className="block mt-0.5 font-medium capitalize">{row.source}</span>
        </div>
        {row.path && (
          <div>
            <span className="text-muted-foreground">Path</span>
            <code className="block mt-0.5">{row.path}</code>
          </div>
        )}
        {row.user_id && (
          <div>
            <span className="text-muted-foreground">User ID</span>
            <code className="block mt-0.5 truncate">{row.user_id}</code>
          </div>
        )}
        {row.error_code && (
          <div>
            <span className="text-muted-foreground">Error Code</span>
            <code className="block mt-0.5">{row.error_code}</code>
          </div>
        )}
      </div>

      <div>
        <span className="text-muted-foreground font-medium">Message</span>
        <p className="mt-1 text-foreground/90 wrap-break-word">{row.error_message}</p>
      </div>

      {row.stack_trace && (
        <div>
          <span className="text-muted-foreground font-medium">Stack Trace</span>
          <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-black/5 dark:bg-white/5 p-3 text-[11px] text-foreground/80 leading-relaxed whitespace-pre-wrap break-all border border-border">
            {row.stack_trace}
          </pre>
        </div>
      )}

      {Object.keys(row.context ?? {}).length > 0 && (
        <div>
          <span className="text-muted-foreground font-medium">Context</span>
          <pre className="mt-1 max-h-32 overflow-auto rounded-lg bg-black/5 dark:bg-white/5 p-3 text-[11px] text-foreground/80 leading-relaxed border border-border">
            {JSON.stringify(row.context, null, 2)}
          </pre>
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        {row.fingerprint && (
          <a
            href={`/dashboard/system/issues?fingerprint=${row.fingerprint}`}
            className="inline-flex items-center gap-1.5 text-[12px] text-indigo-500 hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View issue group
          </a>
        )}
        {!row.resolved_at && onResolve && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                await onResolve(row.id)
              })
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2.5 py-1 text-[12px] font-medium text-emerald-600 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {pending ? "Marking…" : "Mark resolved"}
          </button>
        )}
        {row.resolved_at && (
          <span className="inline-flex items-center gap-1 text-[12px] text-emerald-600">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Resolved{" "}
            {formatDistanceToNow(new Date(row.resolved_at), { addSuffix: true })}
          </span>
        )}
      </div>
    </div>
  )
}

export function ErrorLogsTable({ rows, total, onResolve }: ErrorLogsTableProps) {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (rows.length === 0) {
    return (
      <div className="py-16 text-center text-[13px] text-muted-foreground">
        No error logs found
      </div>
    )
  }

  return (
    <div>
      <p className="mb-3 text-[12px] text-muted-foreground">
        Showing {rows.length} of {total.toLocaleString()} errors
      </p>
      <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
        <div className="grid grid-cols-[100px_1fr_80px_100px] gap-3 px-4 py-2.5 bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span>Severity</span>
          <span>Message</span>
          <span>Source</span>
          <span>Time</span>
        </div>

        {rows.map((row) => {
          const isExpanded = expanded === row.id
          return (
            <div key={row.id}>
              <button
                type="button"
                onClick={() => setExpanded(isExpanded ? null : row.id)}
                className={cn(
                  "grid grid-cols-[100px_1fr_80px_100px] gap-3 w-full px-4 py-3 text-left hover:bg-muted/30 transition-colors items-center",
                  row.resolved_at && "opacity-50",
                )}
              >
                <SeverityBadge severity={row.severity} />
                <div className="flex items-center gap-1.5 min-w-0">
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <p className="text-[12px] truncate text-foreground/90">
                    {row.error_message}
                  </p>
                </div>
                <span className="text-[12px] capitalize text-muted-foreground">
                  {row.source}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
                </span>
              </button>
              {isExpanded && <RowDetail row={row} onResolve={onResolve} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
