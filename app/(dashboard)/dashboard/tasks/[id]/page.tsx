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
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[250px] pl-4 lg:pl-5">User</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead className="text-right pr-4 lg:pr-5">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="pl-4 lg:pl-5">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          {a.assignee?.avatar_url ? (
                            <AvatarImage src={a.assignee.avatar_url} alt={a.assignee.full_name ?? ""} />
                          ) : null}
                          <AvatarFallback className="text-[10px]">
                            {(a.assignee?.full_name ?? a.assignee?.email ?? "U")
                              .slice(0, 2)
                              .toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-semibold truncate leading-tight">
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
                            Reason: {a.late_reason}
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        {a.submitted_at ? (
                          <span className="text-[12.5px] font-medium text-foreground">
                            {new Date(a.submitted_at).toLocaleDateString([], {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </span>
                        ) : (
                          <span className="text-[12px] text-muted-foreground">—</span>
                        )}
                        {a.submitted_at ? (
                          <span className="text-[11.5px] text-muted-foreground">
                            {new Date(a.submitted_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right pr-4 lg:pr-5">
                      <div className="flex items-center justify-end gap-3">
                        {a.submission?.score !== null && a.submission?.score !== undefined ? (
                          <div className="flex flex-col items-end">
                            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Score</span>
                            <span className="text-[14px] font-bold text-primary">{a.submission.score}</span>
                          </div>
                        ) : null}
                        {a.submission_id ? (
                          <Link
                            href={`/dashboard/submissions/${a.submission_id}`}
                            className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-[12px] font-semibold text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                          >
                            Open
                          </Link>
                        ) : (
                          <div className="h-8 w-[58px]" /> /* spacer to align rows */
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      ) : null}
    </div>
  )
}
