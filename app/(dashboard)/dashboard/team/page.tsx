import { redirect } from "next/navigation"
import { requireProfile } from "@/lib/auth"
import { CAPABILITIES, getAccessContext } from "@/lib/permissions"
import { listAllProfiles, listTeamMembers, listTeams } from "@/lib/data"
import { PageHeader } from "@/components/dashboard/page-header"
import { ProvisionUserForm } from "@/components/dashboard/provision-user-form"
import { TeamMembers } from "@/components/dashboard/team-members"

export default async function TeamPage() {
  const profile = await requireProfile()
  const ctx = await getAccessContext(profile)

  // Access is granted by role OR by an explicit capability override. Read
  // capabilities surface the page in read-only mode; write capabilities
  // re-enable edit actions inside the TeamMembers component.
  const canRead =
    profile.role === "main_admin" ||
    profile.role === "manager" ||
    ctx.has(CAPABILITIES.TEAM_MANAGEMENT_READ) ||
    ctx.has(CAPABILITIES.TEAM_MANAGEMENT_WRITE) ||
    ctx.has(CAPABILITIES.USER_MANAGEMENT_READ) ||
    ctx.has(CAPABILITIES.USER_MANAGEMENT_WRITE)
  if (!canRead) redirect("/dashboard")

  const canWrite =
    ctx.has(CAPABILITIES.TEAM_MANAGEMENT_WRITE) ||
    ctx.has(CAPABILITIES.USER_MANAGEMENT_WRITE)

  if (profile.role !== "main_admin") {
    // Manager (always) or Team Member with a read/write override.
    // Scoped to their own team's members.
    const [members, teams] = await Promise.all([listTeamMembers(profile), listTeams()])
    // Managers keep their existing edit affordances. Members only get edit
    // actions when explicitly granted a write capability.
    const isManager = profile.role === "manager" || canWrite
    return (
      <>
        <PageHeader
          title="Team members"
          description={
            isManager
              ? "People on your team."
              : "View people on your team."
          }
        />
        <TeamMembers
          members={members}
          teams={teams}
          actorId={profile.id}
          isManager={isManager}
        />
      </>
    )
  }

  // Main Admin: directory-wide view of all members + provisioning form.
  // Team/department CRUD lives on the separate Departments tab.
  const [allProfiles, teams] = await Promise.all([
    listAllProfiles(profile),
    listTeams(),
  ])

  return (
    <>
      <PageHeader
        title="Team members"
        description="Manage user accounts and provision new members across all departments."
      />

      <div className="grid gap-6 lg:gap-8 lg:grid-cols-[minmax(0,1fr)_420px] items-start">
        <div className="min-w-0">
          <TeamMembers
            members={allProfiles}
            teams={teams}
            actorId={profile.id}
            isMainAdmin
          />
        </div>
        <div className="min-w-0 lg:sticky lg:top-6">
          <ProvisionUserForm teams={teams} />
        </div>
      </div>
    </>
  )
}
