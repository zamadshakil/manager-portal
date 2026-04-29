import { requireRole } from "@/lib/auth"
import { listRules } from "@/lib/data"
import { PageHeader } from "@/components/dashboard/page-header"
import { RulesEditor } from "@/components/dashboard/rules-editor"

export default async function RulesPage() {
  const profile = await requireRole(["main_admin", "manager"])
  const rules = await listRules(profile)

  return (
    <>
      <PageHeader
        title="Validation rules"
        description="Configure how the LLM evaluates submissions for your team."
      />
      <RulesEditor rules={rules} />
    </>
  )
}
