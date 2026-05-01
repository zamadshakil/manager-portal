import { requireRole } from "@/lib/auth"
import { listRules, listTeams } from "@/lib/data"
import { PageHeader } from "@/components/dashboard/page-header"
import { RulesEditor } from "@/components/dashboard/rules-editor"

export default async function RulesPage() {
  const profile = await requireRole(["main_admin", "manager"])
  const rules = await listRules(profile)
  const teams = profile.role === "main_admin" ? await listTeams() : []

  return (
    <>
      <PageHeader
        title="Validation rules"
        description="Configure how the LLM evaluates submissions for your team."
      />
      <RulesEditor rules={rules} teams={teams} profile={profile} />
    </>
  )
}
