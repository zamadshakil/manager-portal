import Link from "next/link"
import { CalendarClock, CheckCircle2, AlertTriangle, Circle } from "lucide-react"
import { formatRelative } from "@/lib/format"
import type { MyTask } from "@/lib/data"

interface MyTasksProps {
  tasks: MyTask[]
}

function statusIcon(status: MyTask["status"]) {
  switch (status) {
    case "submitted":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
    case "late_submitted":
      return <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
    case "missed":
      return <AlertTriangle className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
    default:
      return <Circle className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
  }
}

function statusLabel(status: MyTask["status"]) {
  switch (status) {
    case "submitted":
      return "Submitted"
    case "late_submitted":
      return "Submitted late"
    case "missed":
      return "Missed"
    default:
      return "Pending"
  }
}

export function MyTasks({ tasks }: MyTasksProps) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center shadow-card">
        <p className="text-[14px] font-semibold">No tasks assigned</p>
        <p className="text-[12px] text-muted-foreground mt-1">
          Your manager hasn&apos;t assigned anything yet.
        </p>
      </div>
    )
  }

  return (
    <ul className="grid gap-3">
      {tasks.map((t) => {
        const due = t.task.due_at ? new Date(t.task.due_at) : null
        const overdue =
          due && due.getTime() < Date.now() && t.status === "assigned" && !t.task.allow_late
        return (
          <li
            key={t.id}
            className="rounded-xl border border-border bg-card shadow-card hover:border-primary/50 transition-colors"
          >
            <Link href={`/dashboard/tasks/${t.task.id}`} className="block p-4 lg:p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h3 className="text-[15px] font-semibold tracking-tight truncate">
                    {t.task.title}
                  </h3>
                  {t.task.description ? (
                    <p className="mt-0.5 text-[12.5px] text-muted-foreground line-clamp-2">
                      {t.task.description}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[11.5px] font-medium">
                    <span className="inline-flex items-center gap-1">
                      {statusIcon(t.status)}
                      {statusLabel(t.status)}
                    </span>
                    {due ? (
                      <span
                        className={`inline-flex items-center gap-1 ${
                          overdue
                            ? "text-destructive"
                            : due.getTime() - Date.now() < 24 * 60 * 60 * 1000
                              ? "text-amber-600"
                              : "text-muted-foreground"
                        }`}
                      >
                        <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                        Due {formatRelative(t.task.due_at!)}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
