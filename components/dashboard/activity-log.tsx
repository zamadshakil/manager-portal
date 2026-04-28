import { History } from "lucide-react"
import { formatRelative } from "@/lib/format"
import type { ActivityLogEntry } from "@/lib/types"

interface ActivityLogProps {
  rows: (ActivityLogEntry & { actor_email?: string | null; actor_name?: string | null })[]
  expanded?: boolean
}

function actionLabel(entry: ActivityLogEntry): string {
  const map: Record<string, string> = {
    "submission.created": "uploaded a submission",
    "submission.retried": "retried validation",
    "submission.deleted": "deleted a submission",
    "announcement.created": "posted an announcement",
    "announcement.deleted": "removed an announcement",
    "material.created": "shared a material",
    "material.deleted": "removed a material",
    "rule.created": "added a validation rule",
    "rule.updated": "updated a validation rule",
    "rule.deleted": "removed a validation rule",
    "user.provisioned": "provisioned a user",
  }
  return map[entry.action] ?? entry.action.replace(/[._]/g, " ")
}

export function ActivityLog({ rows, expanded = false }: ActivityLogProps) {
  void expanded
  return (
    <section
      aria-labelledby="activity-heading"
      className="rounded-xl border border-border bg-card shadow-card"
    >
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 lg:px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-warm-white">
          <History className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 id="activity-heading" className="text-[15px] font-semibold tracking-tight">
            Activity log
          </h2>
          <p className="text-[12px] text-muted-foreground">Immutable audit trail.</p>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="px-5 py-10 text-center text-[13px] text-muted-foreground">
          No activity yet.
        </div>
      ) : (
        <ol className="divide-y divide-border">
          {rows.map((entry) => (
            <li key={entry.id} className="px-4 py-3 lg:px-5">
              <p className="text-[13px] leading-snug">
                <span className="font-semibold">
                  {entry.actor_name ?? entry.actor_email ?? "System"}
                </span>{" "}
                <span className="text-muted-foreground">{actionLabel(entry)}</span>
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {formatRelative(entry.created_at)} · {entry.entity_type}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
