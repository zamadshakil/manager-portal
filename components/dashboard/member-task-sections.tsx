"use client"

import type { MyTask } from "@/lib/data"
import { getTaskDeadlineWindow } from "@/lib/task-deadlines"
import { useTaskDeadlineNow } from "@/hooks/use-task-deadline-now"
import { MyTasks } from "@/components/dashboard/my-tasks"

interface MemberTaskSectionsProps {
  tasks: MyTask[]
}

export function MemberTaskSections({ tasks }: MemberTaskSectionsProps) {
  const now = useTaskDeadlineNow(
    tasks.map((task) => ({
      id: task.id,
      dueAt: task.task.due_at,
      allowLate: task.task.allow_late,
      lateSubmissionDeadline: task.task.late_submission_deadline,
    })),
  )

  const open = tasks.filter((task) => {
    if (task.status !== "assigned") return false
    return !getTaskDeadlineWindow(
      {
        dueAt: task.task.due_at,
        allowLate: task.task.allow_late,
        lateSubmissionDeadline: task.task.late_submission_deadline,
      },
      now,
    ).isClosed
  })

  const history = tasks.filter((task) => {
    if (task.status !== "assigned") return true
    return getTaskDeadlineWindow(
      {
        dueAt: task.task.due_at,
        allowLate: task.task.allow_late,
        lateSubmissionDeadline: task.task.late_submission_deadline,
      },
      now,
    ).isClosed
  })

  return (
    <>
      <section className="space-y-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          Open ({open.length})
        </h2>
        <MyTasks tasks={open} now={now} />
      </section>
      <section className="space-y-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          History ({history.length})
        </h2>
        <MyTasks tasks={history} now={now} />
      </section>
    </>
  )
}
