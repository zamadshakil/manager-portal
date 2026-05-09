import { requireRole } from "@/lib/auth"
import { listAllProfiles, listTeamMembers, listTeams } from "@/lib/data"
import { PageHeader } from "@/components/dashboard/page-header"
import { ProvisionUserForm } from "@/components/dashboard/provision-user-form"
import { TeamMembers } from "@/components/dashboard/team-members"

export default async function TeamPage() {
  const profile = await requireRole(["main_admin", "manager"])

  if (profile.role !== "main_admin") {
    // Manager: scoped to their own team's members.
    const [members, teams] = await Promise.all([listTeamMembers(profile), listTeams()])
    return (
      <>
        <PageHeader
          title="Team members"
          description="People on your team."
        />
        <TeamMembers
          members={members}
          teams={teams}
          actorId={profile.id}
          isManager
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
