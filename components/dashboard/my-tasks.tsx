import Link from "next/link"
import { CalendarClock, CheckCircle2, AlertTriangle, Circle, Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDeadline } from "@/lib/format"
import type { MyTask } from "@/lib/data"

interface MyTasksProps {
  tasks: MyTask[]
}

// ---------------------------------------------------------------------------
// Urgency helpers
// ---------------------------------------------------------------------------

type UrgencyTier = "normal" | "urgent" | "late_window" | "expired"

function getUrgencyTier(t: MyTask): UrgencyTier {
  if (t.status !== "assigned") return "normal"
  const now = Date.now()
  const due = t.task.due_at ? new Date(t.task.due_at).getTime() : null
  if (!due) return "normal"
  // Past due_at — check late window
  if (due < now) {
    if (!t.task.allow_late) return "expired"
    const late = t.task.late_submission_deadline
      ? new Date(t.task.late_submission_deadline).getTime()
      : null
    if (!late) return "expired"
    return late < now ? "expired" : "late_window"
  }
  // Still before due_at — urgent if within 24 h
  return due - now < 24 * 60 * 60 * 1000 ? "urgent" : "normal"
}

function statusIcon(status: MyTask["status"], tier: UrgencyTier) {
  if (tier === "expired") return <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
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

function statusLabel(status: MyTask["status"], tier: UrgencyTier): string {
  if (tier === "expired") return "Expired"
  switch (status) {
    case "submitted":      return "Submitted"
    case "late_submitted": return "Submitted late"
    case "missed":         return "Missed"
    default:               return "Pending"
  }
}

// ---------------------------------------------------------------------------
// Urgency pill
// ---------------------------------------------------------------------------

const PILL: Record<Exclude<UrgencyTier, "normal">, { label: string; cls: string }> = {
  urgent:      { label: "Due soon",     cls: "bg-amber-50 text-amber-700 border-amber-200" },
  late_window: { label: "Submit late",  cls: "bg-amber-50 text-amber-800 border-amber-300" },
  expired:     { label: "Expired",      cls: "bg-red-50 text-red-600 border-red-200" },
}

function UrgencyPill({ tier }: { tier: UrgencyTier }) {
  if (tier === "normal") return null
  const p = PILL[tier]
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10.5px] font-semibold leading-none",
        p.cls,
      )}
    >
      {p.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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
        const tier = getUrgencyTier(t)
        const isExpired = tier === "expired"
        const due = t.task.due_at
        const lateDeadline = t.task.late_submission_deadline
        const now = Date.now()
        const inLateWindow =
          tier === "late_window" ||
          (t.status !== "assigned" &&
            due &&
            new Date(due).getTime() < now &&
            t.task.allow_late &&
            lateDeadline)

        // Colour of the due-date line
        const dueColour =
          tier === "expired"
            ? "text-muted-foreground"
            : tier === "late_window"
              ? "text-amber-700"
              : tier === "urgent"
                ? "text-amber-600"
                : "text-muted-foreground"

        return (
          <li
            key={t.id}
            className={cn(
              "rounded-xl border border-border bg-card shadow-card transition-colors",
              isExpired
                ? "opacity-60"
                : "hover:border-primary/50",
            )}
          >
            <Link href={`/dashboard/tasks/${t.task.id}`} className="block p-4 lg:p-5">
              <div className="flex items-start justify-between gap-3">
                {/* Left: title + description + meta */}
                <div className="min-w-0 flex-1">
                  <h3 className="text-[15px] font-semibold tracking-tight truncate">
                    {t.task.title}
                  </h3>
                  {t.task.description ? (
                    <p className="mt-0.5 text-[12.5px] text-muted-foreground line-clamp-2">
                      {t.task.description}
                    </p>
                  ) : null}

                  {/* Status + deadline row */}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] font-medium">
                    <span className={cn(
                      "inline-flex items-center gap-1",
                      t.status === "submitted" ? "text-emerald-600"
                        : t.status === "late_submitted" ? "text-amber-700"
                        : t.status === "missed" ? "text-destructive"
                        : isExpired ? "text-muted-foreground"
                        : "text-muted-foreground",
                    )}>
                      {statusIcon(t.status, tier)}
                      {statusLabel(t.status, tier)}
                    </span>

                    {due ? (
                      <span className={cn("inline-flex items-center gap-1", dueColour)}>
                        <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>
                          <span className="font-semibold">Due</span>{" "}
                          {formatDeadline(due)}
                        </span>
                      </span>
                    ) : null}
                  </div>

                  {/* Late-window line — shown when submission is past due but still allowed */}
                  {inLateWindow && lateDeadline ? (
                    <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-amber-700">
                      <CalendarClock className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span>
                        <span className="font-semibold">Late allowed until</span>{" "}
                        {formatDeadline(lateDeadline)}
                      </span>
                    </div>
                  ) : null}
                </div>

                {/* Right: urgency pill */}
                <div className="mt-0.5 shrink-0">
                  <UrgencyPill tier={tier} />
                </div>
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
