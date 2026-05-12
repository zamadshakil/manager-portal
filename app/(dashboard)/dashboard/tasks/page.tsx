import { redirect } from "next/navigation"
import { requireProfile } from "@/lib/auth"
import { CAPABILITIES, getAccessContext } from "@/lib/permissions"
import {
  listTasksForManager,
  listMyTasks,
  listTeams,
  listTeamMembers,
  listRules,
} from "@/lib/data"
import { PageHeader } from "@/components/dashboard/page-header"
import { NewTaskDialog } from "@/components/dashboard/new-task-dialog"
import { TaskList } from "@/components/dashboard/task-list"
import { MyTasks } from "@/components/dashboard/my-tasks"

export default async function TasksPage() {
  const profile = await requireProfile()
  const ctx = await getAccessContext(profile)
  const canReadTasks = ctx.has(CAPABILITIES.TASKS_READ)
  const canCreateTasks = ctx.has(CAPABILITIES.TASKS_CREATE)
  const canAssignTasks = ctx.has(CAPABILITIES.TASKS_ASSIGN)
  const canDeleteTasks = ctx.has(CAPABILITIES.TASKS_DELETE)
  const canManageTasks = canCreateTasks || canAssignTasks || canDeleteTasks

  if (!canReadTasks && !canManageTasks) {
    redirect("/dashboard")
  }

  if (!canManageTasks) {
    const myTasks = await listMyTasks(profile)

    // Determine whether a still-"assigned" task's submission window has fully
    // closed so it can be demoted to History client-side (no DB write needed —
    // this is a deterministic UI-only computation; the cron still marks missed).
    function isWindowClosed(t: (typeof myTasks)[number]): boolean {
      if (t.status !== "assigned") return false
      const now = Date.now()
      const due = t.task.due_at ? new Date(t.task.due_at).getTime() : null
      if (!due) return false                         // no deadline — never closes
      if (!t.task.allow_late) return due < now       // strict deadline
      const late = t.task.late_submission_deadline
        ? new Date(t.task.late_submission_deadline).getTime()
        : null
      return late ? late < now : due < now           // uses late window when set
    }

    // "open"    → still actionable (submission window is open)
    // "history" → terminal statuses + expired-but-not-yet-cron-marked tasks
    const open = myTasks.filter((t) => t.status === "assigned" && !isWindowClosed(t))
    const history = myTasks.filter((t) => t.status !== "assigned" || isWindowClosed(t))

    return (
      <div className="space-y-6 lg:space-y-8">
        <PageHeader
          title="Your tasks"
          description="Submissions assigned to you, ordered by deadline."
        />
        <section className="space-y-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Open ({open.length})
          </h2>
          <MyTasks tasks={open} />
        </section>
        <section className="space-y-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            History ({history.length})
          </h2>
          <MyTasks tasks={history} />
        </section>
      </div>
    )
  }

  const [tasks, teams, members, rules] = await Promise.all([
    listTasksForManager(profile),
    profile.role === "main_admin" ? listTeams() : Promise.resolve([]),
    listTeamMembers(profile),
    canCreateTasks ? listRules(profile) : Promise.resolve([]),
  ])

  const composerTeams =
    profile.role === "main_admin"
      ? teams
      : profile.team_id
        ? [
            {
              id: profile.team_id,
              name: "My team",
              description: null,
              manager_id: profile.id,
              settings: {},
              created_at: "",
              updated_at: "",
            },
          ]
        : []

  return (
    <div className="space-y-6 lg:space-y-8">
      <PageHeader
        title="Tasks"
        description="Assign briefs to your team and track AI-validated submissions."
        action={
          canCreateTasks ? (
            <NewTaskDialog
              teams={composerTeams}
              defaultTeamId={profile.team_id}
              members={members}
              rules={rules}
            />
          ) : null
        }
      />

      <section>
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted-foreground mb-3">
          All tasks ({tasks.length})
        </h2>
        <TaskList tasks={tasks} canDelete={canDeleteTasks} />
      </section>
    </div>
  )
}
