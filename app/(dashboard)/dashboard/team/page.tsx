import { requireRole } from "@/lib/auth"
import { listAllProfiles, listTeamMembers, listTeams } from "@/lib/data"
import { PageHeader } from "@/components/dashboard/page-header"
import { ProvisionUserForm } from "@/components/dashboard/provision-user-form"
import { TeamMembers } from "@/components/dashboard/team-members"
import { TeamAdminPanel } from "@/components/dashboard/team-admin-panel"
import { TeamPageTabs } from "@/components/dashboard/team-page-tabs"

export default async function TeamPage() {
  const profile = await requireRole(["main_admin", "manager"])

  if (profile.role !== "main_admin") {
    // Manager: scoped to their own team's members.
    const [members, teams] = await Promise.all([listTeamMembers(profile), listTeams()])
    return (
      <>
        <PageHeader
          title="Team members"
          description="Members on your team and their submission performance."
        />
        <TeamMembers members={members} teams={teams} />
      </>
    )
  }

  // Main Admin: directory-wide view. One round-trip via `listAllProfiles`
  // covers both the roster (Provisioning tab) and the manager dropdown
  // (Teams tab) — no duplicate query, no `as any` cast.
  const [allProfiles, teams] = await Promise.all([
    listAllProfiles(profile),
    listTeams(),
  ])
  const managers = allProfiles.filter((p) => p.role === "manager")

  return (
    <>
      <PageHeader
        title="Team management"
        description="Manage teams, provision members, and assign managers."
      />

      <TeamPageTabs
        teamsSlot={<TeamAdminPanel teams={teams} managers={managers} />}
        provisioningSlot={
          <div className="grid gap-6 lg:gap-8 lg:grid-cols-[minmax(0,1fr)_420px] items-start">
            <div className="min-w-0">
              <TeamMembers members={allProfiles} teams={teams} />
            </div>
            <div className="min-w-0 lg:sticky lg:top-6">
              <ProvisionUserForm teams={teams} />
            </div>
          </div>
        }
      />
    </>
  )
}
