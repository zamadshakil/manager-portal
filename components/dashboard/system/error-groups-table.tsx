"use client"

import Link from "next/link"
import { formatDistanceToNow } from "date-fns"
import { AlertCircle, AlertTriangle, Info, Users, RefreshCw, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ErrorGroup } from "@/lib/system"

interface ErrorGroupsTableProps {
  groups: ErrorGroup[]
}

const SEVERITY_ICON = {
  error: { icon: AlertCircle, cls: "text-red-500" },
  warning: { icon: AlertTriangle, cls: "text-amber-500" },
  info: { icon: Info, cls: "text-blue-500" },
}

export function ErrorGroupsTable({ groups }: ErrorGroupsTableProps) {
  if (groups.length === 0) {
    return (
      <div className="py-16 text-center text-[13px] text-muted-foreground">
        No error groups in the last 7 days
      </div>
    )
  }

  return (
    <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-[1fr_80px_80px_120px_100px] gap-4 px-4 py-2.5 bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>Issue</span>
        <span>Events</span>
        <span>Users</span>
        <span>Last seen</span>
        <span>Status</span>
      </div>

      {groups.map((group) => {
        const { icon: Icon, cls } = SEVERITY_ICON[group.severity]
        return (
          <div
            key={group.fingerprint}
            className={cn(
              "grid grid-cols-[1fr_80px_80px_120px_100px] gap-4 px-4 py-3.5 items-center hover:bg-muted/30 transition-colors",
              group.resolved && "opacity-50",
            )}
          >
            {/* Issue description */}
            <div className="flex items-start gap-2.5 min-w-0">
              <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", cls)} />
              <div className="min-w-0">
                <p className="text-[13px] font-medium truncate leading-snug">
                  {group.error_message}
                </p>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                  <code className="bg-muted px-1 py-0.5 rounded text-[10px]">{group.source}</code>
                  {group.sample_path && (
                    <span className="truncate max-w-xs">{group.sample_path}</span>
                  )}
                  <span className="shrink-0">
                    first{" "}
                    {formatDistanceToNow(new Date(group.first_seen), { addSuffix: true })}
                  </span>
                </div>
              </div>
            </div>

            {/* Occurrences */}
            <div className="flex items-center gap-1 text-[13px] font-semibold tabular-nums">
              <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
              {group.occurrences.toLocaleString()}
            </div>

            {/* Affected users */}
            <div className="flex items-center gap-1 text-[13px] tabular-nums text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              {group.affected_users}
            </div>

            {/* Last seen */}
            <span className="text-[12px] text-muted-foreground">
              {formatDistanceToNow(new Date(group.last_seen), { addSuffix: true })}
            </span>

            {/* Status */}
            <div>
              {group.resolved ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Resolved
                </span>
              ) : (
                <Link
                  href={`/system-monitor/errors?fingerprint=${group.fingerprint}`}
                  className="inline-flex items-center gap-1 rounded-md bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-600 hover:bg-red-500/20 transition-colors"
                >
                  <AlertCircle className="h-3 w-3" />
                  Open
                </Link>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
