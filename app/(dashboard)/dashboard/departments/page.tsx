import { requireRole } from "@/lib/auth"
import { listDepartmentsWithStats } from "@/lib/data"
import { PageHeader } from "@/components/dashboard/page-header"
import { DepartmentList } from "@/components/dashboard/department-list"
import { DepartmentForm } from "@/components/dashboard/department-form"

export const dynamic = "force-dynamic"

export default async function DepartmentsPage() {
  await requireRole(["main_admin"])
  const departments = await listDepartmentsWithStats()

  return (
    <>
      <PageHeader
        title="Departments"
        description="Manage organizational structures, assign managers, and group members."
      />
      
      <div className="grid gap-6 lg:gap-8 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            All Departments ({departments.length})
          </h2>
          <DepartmentList departments={departments} />
        </div>
        
        <div className="space-y-4">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Quick Actions
          </h2>
          <DepartmentForm />
        </div>
      </div>
    </>
  )
}
