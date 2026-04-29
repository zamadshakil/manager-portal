import { requireRole } from "@/lib/auth"
import { listTeamMembers, listTeams } from "@/lib/data"
import { PageHeader } from "@/components/dashboard/page-header"
import { ProvisionUserForm } from "@/components/dashboard/provision-user-form"
import { TeamMembers } from "@/components/dashboard/team-members"
import { TeamCreatorForm } from "@/components/dashboard/team-creator-form"
import { TeamAdminPanel } from "@/components/dashboard/team-admin-panel"

export const dynamic = "force-dynamic"

export default async function TeamPage() {
  const profile = await requireRole(["main_admin", "manager"])
  const [members, teams] = await Promise.all([listTeamMembers(profile), listTeams()])

  // Get all managers for team assignment dropdown
  const allProfiles = await listTeamMembers({ ...profile, role: "main_admin" } as any)
  const managers = allProfiles.filter((p) => p.role === "manager")

  return (
    <>
      <PageHeader
        title={profile.role === "main_admin" ? "Team management" : "Team members"}
        description={
          profile.role === "main_admin"
            ? "Manage teams, provision members, and assign managers."
            : "Members on your team and their submission performance."
        }
      />

      {profile.role === "main_admin" ? (
        <TeamAdminPanel teams={teams} managers={managers} />
      ) : (
        <div className="grid gap-6 lg:gap-8 lg:grid-cols-[1fr_360px]">
          <TeamMembers members={members} teams={teams} viewerRole={profile.role} />
        </div>
      )}

      {profile.role === "main_admin" ? (
        <div className="mt-8">
          <PageHeader title="User provisioning" description="Create and manage user accounts." />
          <ProvisionUserForm teams={teams} />
        </div>
      ) : (
        <TeamMembers members={members} teams={teams} viewerRole={profile.role} />
      )}
    </>
  )
}
