import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, CalendarClock, Users, AlertTriangle, ListChecks, Sparkles } from "lucide-react"
import { requireProfile } from "@/lib/auth"
import { CAPABILITIES, getAccessContext } from "@/lib/permissions"
import {
  getTaskById,
  getMyAssignmentForTask,
  listAssignmentsForTask,
  listRules,
} from "@/lib/data"
import { PageHeader } from "@/components/dashboard/page-header"
import { TaskSubmissionForm } from "@/components/dashboard/task-submission-form"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { DeleteTaskButton } from "@/components/dashboard/delete-task-button"
import { TaskEditor } from "@/components/dashboard/task-editor"
import { AssignmentsRealtimeListener } from "@/components/dashboard/assignments-realtime-listener"
import { formatDeadline } from "@/lib/format"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const profile = await requireProfile()
  const ctx = await getAccessContext(profile)

  const task = await getTaskById(profile, id)
  if (!task) notFound()

  const myAssignment = await getMyAssignmentForTask(profile, id)
  const scope = { team_id: task.team_id, is_global: false }
  const canReadTask = ctx.hasScoped(CAPABILITIES.TASKS_READ, scope)
  const canCreateTask = ctx.hasScoped(CAPABILITIES.TASKS_CREATE, scope)
  const canAssignTask = ctx.hasScoped(CAPABILITIES.TASKS_ASSIGN, scope)
  const canDeleteTask = ctx.hasScoped(CAPABILITIES.TASKS_DELETE, scope)
  const canUpdateTask = ctx.hasScoped(CAPABILITIES.TASKS_UPDATE, scope)
  const canManageTask = canCreateTask || canAssignTask || canDeleteTask

  if (!canReadTask && !canManageTask && !myAssignment) {
    notFound()
  }
  // Plain members without an assignment and without any management capability
  // must not access this task
  if (profile.role === "member" && !myAssignment && !canManageTask) {
    notFound()
  }

  const rules = canUpdateTask ? await listRules(profile) : []

  const assignments = canManageTask
    ? (await listAssignmentsForTask(id)).map((a) => {
        if (a.status === "assigned" && !a.submission_id) {
          return { ...a, status: "pending" as any }
        }
        return a
      })
    : []

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
        action={canDeleteTask ? <DeleteTaskButton taskId={task.id} /> : undefined}
      />

      {canUpdateTask ? <TaskEditor task={task} rules={rules} /> : null}

      {/* Meta strip */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-card">
        <span
          className={`inline-flex items-center gap-1 text-[12px] font-semibold ${
            overdue ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
          {due ? (
            <>
              <span className="font-semibold">Due</span>{" "}
              {formatDeadline(task.due_at!)}
            </>
          ) : "No deadline"}
        </span>
        <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-muted-foreground">
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
          {task.submitted_count}/{task.total_assigned} submitted
        </span>
        {task.allow_late && task.late_submission_deadline ? (
          <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-amber-600">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="font-semibold">Late allowed until</span>{" "}
            {formatDeadline(task.late_submission_deadline!)}
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
      {canManageTask && task.instructions ? (
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
      {myAssignment ? (
        <section className="rounded-xl border border-border bg-card shadow-card">
          <header className="px-4 py-3.5 lg:px-5 border-b border-border flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f2f9ff] text-[#097fe8]">
              <ListChecks className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">Your submission</h2>
              <p className="text-[12px] text-muted-foreground">
                {myAssignment?.status === "assigned"
                  ? "Upload your work for review."
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
            {myAssignment.status === "assigned" ? (
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
      {canManageTask ? (
        <section className="rounded-xl border border-border bg-card shadow-card">
          <AssignmentsRealtimeListener taskId={task.id} />
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
            <>
              {/* Mobile: card list */}
              <ul className="md:hidden divide-y divide-border">
                {assignments.map((a) => (
                  <li key={a.id} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <Avatar className="h-9 w-9 shrink-0 border border-border/50">
                        {a.assignee?.avatar_url ? (
                          <AvatarImage src={a.assignee.avatar_url} alt={a.assignee.full_name ?? ""} />
                        ) : null}
                        <AvatarFallback className="text-[11px] font-bold bg-muted">
                          {(a.assignee?.full_name ?? a.assignee?.email ?? "U")
                            .slice(0, 2)
                            .toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[13.5px] font-semibold truncate leading-tight">
                              {a.assignee?.full_name ?? "Unknown User"}
                            </p>
                            <p className="text-[11.5px] text-muted-foreground truncate leading-tight">
                              {a.assignee?.email}
                            </p>
                          </div>
                          {a.submission_id ? (
                            <Link
                              href={`/dashboard/submissions/${a.submission_id}`}
                              className="inline-flex h-7 shrink-0 items-center justify-center rounded-md bg-primary/10 px-2.5 text-[11.5px] font-semibold text-primary transition-colors hover:bg-primary/20"
                            >
                              Open
                            </Link>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={a.status} />
                          {a.submission?.status ? (
                            <StatusBadge status={a.submission.status as any} />
                          ) : null}
                          {a.submitted_at ? (
                            <span className="text-[11px] text-muted-foreground">
                              {new Date(a.submitted_at).toLocaleDateString([], {
                                month: "short",
                                day: "numeric",
                              })}
                              {" · "}
                              {new Date(a.submitted_at).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          ) : (
                            <span className="text-[11px] text-muted-foreground italic">No submission yet</span>
                          )}
                        </div>
                        {a.late_reason ? (
                          <p className="text-[11px] text-amber-700 font-medium">
                            Late: {a.late_reason}
                          </p>
                        ) : null}
                        {a.submission ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[11.5px] font-bold text-primary">
                              Score: {a.submission.score ?? "—"}
                            </span>
                            {a.submission.summary ? (
                              <p className="text-[11px] text-muted-foreground line-clamp-2 leading-tight">
                                {a.submission.summary}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              {/* Desktop: table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-[280px] pl-4 lg:pl-5">Team Member Name</TableHead>
                      <TableHead>Current Status</TableHead>
                      <TableHead>Submission Timestamp</TableHead>
                      <TableHead>AI Validation</TableHead>
                      <TableHead className="text-right pr-4 lg:pr-5">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assignments.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="pl-4 lg:pl-5">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-9 w-9 border border-border/50">
                              {a.assignee?.avatar_url ? (
                                <AvatarImage src={a.assignee.avatar_url} alt={a.assignee.full_name ?? ""} />
                              ) : null}
                              <AvatarFallback className="text-[11px] font-bold bg-muted">
                                {(a.assignee?.full_name ?? a.assignee?.email ?? "U")
                                  .slice(0, 2)
                                  .toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                              <p className="text-[13.5px] font-semibold truncate leading-tight">
                                {a.assignee?.full_name ?? "Unknown User"}
                              </p>
                              <p className="text-[11.5px] text-muted-foreground truncate leading-tight mt-0.5">
                                {a.assignee?.email}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-2">
                              <StatusBadge status={a.status} />
                              {a.submission?.status ? (
                                <StatusBadge status={a.submission.status as any} />
                              ) : null}
                            </div>
                            {a.late_reason ? (
                              <p className="text-[11px] text-amber-700 font-medium">
                                Late: {a.late_reason}
                              </p>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            {a.submitted_at ? (
                              <>
                                <span className="text-[12.5px] font-medium text-foreground">
                                  {new Date(a.submitted_at).toLocaleDateString([], {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                  })}
                                </span>
                                <span className="text-[11.5px] text-muted-foreground">
                                  {new Date(a.submitted_at).toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                              </>
                            ) : (
                              <span className="text-[12px] text-muted-foreground italic">Pending</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {a.submission ? (
                            <div className="flex flex-col gap-1 max-w-[200px]">
                              <div className="flex items-center gap-2">
                                <span className="text-[12px] font-bold text-primary">
                                  Score: {a.submission.score ?? "—"}
                                </span>
                              </div>
                              {a.submission.summary ? (
                                <p className="text-[11px] text-muted-foreground line-clamp-2 leading-tight">
                                  {a.submission.summary}
                                </p>
                              ) : (
                                <span className="text-[11px] text-muted-foreground italic">No summary available</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-[11px] text-muted-foreground italic">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right pr-4 lg:pr-5">
                          <div className="flex items-center justify-end gap-3">
                            {a.submission_id ? (
                              <Link
                                href={`/dashboard/submissions/${a.submission_id}`}
                                className="inline-flex h-8 items-center justify-center rounded-md bg-primary/10 px-3 text-[12px] font-semibold text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                              >
                                Open
                              </Link>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </section>
      ) : null}
    </div>
  )
}
