import { requireRole } from "@/lib/auth"
import { listTeamMembers, listTeams } from "@/lib/data"
import { PageHeader } from "@/components/dashboard/page-header"
import { ProvisionUserForm } from "@/components/dashboard/provision-user-form"
import { TeamMembers } from "@/components/dashboard/team-members"

export const dynamic = "force-dynamic"

export default async function TeamPage() {
  const profile = await requireRole(["main_admin", "manager"])
  const [members, teams] = await Promise.all([listTeamMembers(profile), listTeams()])

  return (
    <>
      <PageHeader
        title="Team members"
        description={
          profile.role === "main_admin"
            ? "Provision and manage every account in the workspace."
            : "Members on your team and their submission performance."
        }
      />
      <div className="grid gap-6 lg:gap-8 lg:grid-cols-[1fr_360px]">
        <TeamMembers members={members} teams={teams} viewerRole={profile.role} />
        {profile.role === "main_admin" ? <ProvisionUserForm teams={teams} /> : null}
      </div>
    </>
  )
}
