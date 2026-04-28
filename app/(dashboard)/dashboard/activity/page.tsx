import { requireRole } from "@/lib/auth"
import { listActivity } from "@/lib/data"
import { PageHeader } from "@/components/dashboard/page-header"
import { ActivityLog } from "@/components/dashboard/activity-log"

export const dynamic = "force-dynamic"

export default async function ActivityPage() {
  const profile = await requireRole(["main_admin", "manager"])
  const rows = await listActivity(profile, 200)

  return (
    <>
      <PageHeader
        title="Activity log"
        description="Append-only audit trail of every action taken in the workspace."
      />
      <ActivityLog rows={rows} expanded />
    </>
  )
}
