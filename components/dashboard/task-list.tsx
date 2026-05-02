import Link from "next/link"
import { CalendarClock, Users, AlertTriangle, CheckCircle2 } from "lucide-react"
import { formatRelative } from "@/lib/format"
import { DeleteTaskButton } from "@/components/dashboard/delete-task-button"
import type { TaskWithStats } from "@/lib/data"

interface TaskListProps {
  tasks: TaskWithStats[]
  emptyHint?: string
}

function dueLabel(dueAt: string | null): { label: string; tone: "default" | "warn" | "danger" } {
  if (!dueAt) return { label: "No deadline", tone: "default" }
  const ms = new Date(dueAt).getTime() - Date.now()
  if (ms < 0) return { label: `Overdue · ${formatRelative(dueAt)}`, tone: "danger" }
  const days = ms / (1000 * 60 * 60 * 24)
  if (days < 1) return { label: `Due ${formatRelative(dueAt)}`, tone: "warn" }
  return { label: `Due ${formatRelative(dueAt)}`, tone: "default" }
}

export function TaskList({ tasks, emptyHint }: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center shadow-card">
        <p className="text-[14px] font-semibold">No tasks yet</p>
        <p className="text-[12px] text-muted-foreground mt-1">
          {emptyHint ?? "Create your first task to assign it to your team."}
        </p>
      </div>
    )
  }

  return (
    <ul className="grid gap-3">
      {tasks.map((t) => {
        const due = dueLabel(t.due_at)
        const completion =
          t.total_assigned > 0 ? Math.round((t.submitted_count / t.total_assigned) * 100) : 0
        return (
          <li
            key={t.id}
            className="rounded-xl border border-border bg-card shadow-card hover:border-primary/50 transition-colors"
          >
            <Link href={`/dashboard/tasks/${t.id}`} className="block p-4 lg:p-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <h3 className="text-[15px] font-semibold tracking-tight truncate">{t.title}</h3>
                  {t.description ? (
                    <p className="mt-0.5 text-[12.5px] text-muted-foreground line-clamp-2">
                      {t.description}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[11.5px] font-medium">
                    <span
                      className={`inline-flex items-center gap-1 ${
                        due.tone === "danger"
                          ? "text-destructive"
                          : due.tone === "warn"
                            ? "text-amber-600"
                            : "text-muted-foreground"
                      }`}
                    >
                      <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                      {due.label}
                    </span>
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Users className="h-3.5 w-3.5" aria-hidden="true" />
                      {t.submitted_count}/{t.total_assigned} submitted
                    </span>
                    {t.late_count > 0 ? (
                      <span className="inline-flex items-center gap-1 text-amber-600">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                        {t.late_count} late
                      </span>
                    ) : null}
                    {t.missed_count > 0 ? (
                      <span className="inline-flex items-center gap-1 text-destructive">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                        {t.missed_count} missed
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="inline-flex items-center gap-1 rounded-full bg-warm-white px-2.5 py-0.5 text-[11px] font-semibold">
                    <CheckCircle2 className="h-3 w-3 text-primary" aria-hidden="true" />
                    {completion}%
                  </span>
                  <DeleteTaskButton taskId={t.id} iconOnly />
                </div>
              </div>
              {t.total_assigned > 0 ? (
                <div className="mt-3 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${completion}%` }}
                  />
                </div>
              ) : null}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
