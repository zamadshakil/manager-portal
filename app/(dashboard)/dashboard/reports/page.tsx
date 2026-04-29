import { requireRole } from "@/lib/auth"
import { getDailyMetrics } from "@/lib/data"
import { PageHeader } from "@/components/dashboard/page-header"
import { ReportsChartLazy } from "@/components/dashboard/reports-chart-lazy"

export default async function ReportsPage() {
  const profile = await requireRole(["main_admin", "manager"])
  const daily = await getDailyMetrics(profile, 90)

  return (
    <>
      <PageHeader
        title="Reports"
        description="Day-, week-, and month-level analytics for submissions and validation."
      />
      <ReportsChartLazy daily={daily} />
    </>
  )
}
