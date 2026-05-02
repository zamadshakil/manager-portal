import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, CalendarClock, Users, AlertTriangle, ListChecks, Sparkles } from "lucide-react"
import { requireProfile, canManageTeam } from "@/lib/auth"
import {
  getTaskById,
  getMyAssignmentForTask,
  listAssignmentsForTask,
} from "@/lib/data"
import { PageHeader } from "@/components/dashboard/page-header"
import { TaskSubmissionForm } from "@/components/dashboard/task-submission-form"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { DeleteTaskButton } from "@/components/dashboard/delete-task-button"
import { formatRelative } from "@/lib/format"

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const profile = await requireProfile()

  const task = await getTaskById(profile, id)
  if (!task) notFound()

  const isManager = canManageTeam(profile, task.team_id)
  const myAssignment = await getMyAssignmentForTask(profile, id)
  const assignments = isManager ? await listAssignmentsForTask(id) : []

  const due = task.due_at ? new Date(task.due_at) : null
  const overdue = due ? due.getTime() < Date.now() : false

  return (
    <div className="space-y-6 lg:space-y-8">
      <Link
        href="/dashboard/tasks"
        className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Back to tasks
      </Link>

      <PageHeader
        title={task.title}
        description={task.description ?? "Task details and submission."}
        action={isManager ? <DeleteTaskButton taskId={task.id} /> : undefined}
      />

      {/* Meta strip */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-card">
        <span
          className={`inline-flex items-center gap-1 text-[12px] font-semibold ${
            overdue ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
          {due ? `Due ${formatRelative(task.due_at!)}` : "No deadline"}
        </span>
        <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-muted-foreground">
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
          {task.submitted_count}/{task.total_assigned} submitted
        </span>
        {task.allow_late && task.late_submission_deadline ? (
          <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-amber-600">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
            Late allowed up to {formatRelative(task.late_submission_deadline)}
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

      {/* Instructions */}
      {isManager && task.instructions ? (
        <section className="rounded-xl border border-border bg-card shadow-card">
          <header className="px-4 py-3.5 lg:px-5 border-b border-border flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f2f9ff] text-[#097fe8]">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">AI evaluation brief</h2>
              <p className="text-[12px] text-muted-foreground">
                The pipeline evaluates each submission against this brief.
              </p>
            </div>
          </header>
          <pre className="p-4 lg:p-5 text-[13px] whitespace-pre-wrap font-sans leading-relaxed text-foreground/90">
            {task.instructions}
          </pre>
        </section>
      ) : null}

      {/* Member submission form (or read-only state) */}
      {profile.role === "member" || myAssignment ? (
        <section className="rounded-xl border border-border bg-card shadow-card">
          <header className="px-4 py-3.5 lg:px-5 border-b border-border flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f2f9ff] text-[#097fe8]">
              <ListChecks className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">Your submission</h2>
              <p className="text-[12px] text-muted-foreground">
                {myAssignment?.status === "assigned"
                  ? "Upload your work for AI validation."
                  : myAssignment?.status === "submitted"
                    ? "You submitted on time."
                    : myAssignment?.status === "late_submitted"
                      ? "You submitted past the deadline."
                      : myAssignment?.status === "missed"
                        ? "Submission window has closed."
                        : "You are not assigned to this task."}
              </p>
            </div>
          </header>
          <div className="p-4 lg:p-5">
            {!myAssignment ? (
              <p className="text-[13px] text-muted-foreground">
                Ask your manager to add you to this task.
              </p>
            ) : myAssignment.status === "assigned" ? (
              <TaskSubmissionForm
                taskId={task.id}
                taskTitle={task.title}
                dueAt={task.due_at}
                allowLate={task.allow_late}
                lateSubmissionDeadline={task.late_submission_deadline}
                requireLateReason={task.require_late_reason}
              />
            ) : (
              <div className="space-y-2">
                <p className="text-[13px]">
                  Status:{" "}
                  <span className="font-semibold">
                    {myAssignment.status.replace("_", " ")}
                  </span>
                </p>
                {myAssignment.late_reason ? (
                  <p className="text-[12.5px] text-muted-foreground">
                    <span className="font-semibold">Reason given:</span>{" "}
                    {myAssignment.late_reason}
                  </p>
                ) : null}
                {myAssignment.submission_id ? (
                  <Link
                    href={`/dashboard/submissions/${myAssignment.submission_id}`}
                    className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary hover:underline"
                  >
                    Open submission
                  </Link>
                ) : null}
              </div>
            )}
          </div>
        </section>
      ) : null}

      {/* Manager assignment table */}
      {isManager ? (
        <section className="rounded-xl border border-border bg-card shadow-card">
          <header className="px-4 py-3.5 lg:px-5 border-b border-border">
            <h2 className="text-[15px] font-semibold tracking-tight">Assignments</h2>
            <p className="text-[12px] text-muted-foreground">
              Per-member status and AI validation outcomes.
            </p>
          </header>
          {assignments.length === 0 ? (
            <p className="px-4 lg:px-5 py-8 text-[13px] text-muted-foreground text-center">
              No one is assigned to this task yet.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {assignments.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center gap-3 px-4 lg:px-5 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold truncate">
                      {a.assignee?.full_name ?? a.assignee?.email ?? "Unknown user"}
                    </p>
                    <p className="text-[11.5px] text-muted-foreground truncate">
                      {a.assignee?.email}
                    </p>
                    {a.late_reason ? (
                      <p className="text-[11.5px] text-amber-700 mt-1">
                        Late reason: {a.late_reason}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={a.status} />
                      {a.submission?.status ? (
                        <StatusBadge status={a.submission.status as any} />
                      ) : null}
                    </div>
                    {a.submitted_at ? (
                      <span className="text-[11.5px] text-muted-foreground whitespace-nowrap">
                        {new Date(a.submitted_at).toLocaleString([], {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </span>
                    ) : null}
                    {a.submission?.score !== null && a.submission?.score !== undefined ? (
                      <span className="text-[12px] font-medium text-foreground">
                        Score: {a.submission.score}/100
                      </span>
                    ) : null}
                  </div>
                  {a.submission_id ? (
                    <Link
                      href={`/dashboard/submissions/${a.submission_id}`}
                      className="text-[12px] font-semibold text-primary hover:underline ml-2"
                    >
                      Open
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  )
}
