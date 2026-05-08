import { CAPABILITIES, requireCapability } from "@/lib/permissions"
import { listRules, listTeams } from "@/lib/data"
import { PageHeader } from "@/components/dashboard/page-header"
import { RulesEditor } from "@/components/dashboard/rules-editor"

export default async function RulesPage() {
  // Capability-driven gate. Members granted `validation_rules.read` via an
  // admin override now reach this page; managers / members without the
  // capability are redirected to the dashboard.
  const { profile } = await requireCapability(CAPABILITIES.VALIDATION_RULES_READ)
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
