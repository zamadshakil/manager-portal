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
import { MemberTaskSections } from "@/components/dashboard/member-task-sections"

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

    return (
      <div className="space-y-6 lg:space-y-8">
        <PageHeader
          title="Your tasks"
          description="Submissions assigned to you, ordered by deadline."
        />
        <MemberTaskSections tasks={myTasks} />
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
