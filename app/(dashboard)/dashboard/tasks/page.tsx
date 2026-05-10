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
import { TaskComposer } from "@/components/dashboard/task-composer"
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
    const open = myTasks.filter((t) => t.status === "assigned")
    const closed = myTasks.filter((t) => t.status !== "assigned")
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
            History ({closed.length})
          </h2>
          <MyTasks tasks={closed} />
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
        description="Create briefs, assign them to your team, and track AI-validated submissions."
      />

      {canCreateTasks ? (
        <TaskComposer
          teams={composerTeams}
          defaultTeamId={profile.team_id}
          members={members}
          rules={rules}
        />
      ) : null}

      <section>
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted-foreground mb-3">
          All tasks
        </h2>
        <TaskList tasks={tasks} canDelete={canDeleteTasks} />
      </section>
    </div>
  )
}
