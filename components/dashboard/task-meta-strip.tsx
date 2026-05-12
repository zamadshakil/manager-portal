"use client"

import { AlertTriangle, CalendarClock, Users } from "lucide-react"
import type { TaskWithStats } from "@/lib/data"
import { formatDeadline } from "@/lib/format"
import { getTaskDeadlineWindow } from "@/lib/task-deadlines"
import { useTaskDeadlineNow } from "@/hooks/use-task-deadline-now"
import { cn } from "@/lib/utils"

interface TaskMetaStripProps {
  task: TaskWithStats
}

export function TaskMetaStrip({ task }: TaskMetaStripProps) {
  const now = useTaskDeadlineNow([
    {
      id: task.id,
      dueAt: task.due_at,
      allowLate: task.allow_late,
      lateSubmissionDeadline: task.late_submission_deadline,
    },
  ])
  const deadline = getTaskDeadlineWindow(
    {
      dueAt: task.due_at,
      allowLate: task.allow_late,
      lateSubmissionDeadline: task.late_submission_deadline,
    },
    now,
  )

  const dueTone = deadline.phase === "closed"
    ? "text-destructive"
    : deadline.phase === "late_window"
      ? "text-amber-600"
      : "text-muted-foreground"

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-card">
      <span className={cn("inline-flex items-center gap-1 text-[12px] font-semibold", dueTone)}>
        <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
        {task.due_at ? (
          <>
            <span className="font-semibold">Due</span>{" "}
            {formatDeadline(task.due_at)}
          </>
        ) : "No deadline"}
      </span>
      <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-muted-foreground">
        <Users className="h-3.5 w-3.5" aria-hidden="true" />
        {task.submitted_count}/{task.total_assigned} submitted
      </span>
      {task.allow_late && task.late_submission_deadline ? (
        <span className={cn(
          "inline-flex items-center gap-1 text-[12px] font-semibold",
          deadline.phase === "closed" ? "text-muted-foreground" : "text-amber-600",
        )}>
          <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="font-semibold">Late allowed until</span>{" "}
          {formatDeadline(task.late_submission_deadline)}
        </span>
      ) : null}
      {task.late_count > 0 ? (
        <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-amber-600">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          {task.late_count} late
        </span>
      ) : null}
      {task.missed_count > 0 ? (
        <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          {task.missed_count} missed
        </span>
      ) : null}
    </div>
  )
}
