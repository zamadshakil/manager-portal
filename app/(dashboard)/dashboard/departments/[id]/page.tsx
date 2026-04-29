import { notFound } from "next/navigation"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { requireRole } from "@/lib/auth"
import { getDepartmentById, listTeamMembers, listUnassignedMembers } from "@/lib/data"
import { PageHeader } from "@/components/dashboard/page-header"
import { DepartmentDetail } from "@/components/dashboard/department-detail"
import { DepartmentForm } from "@/components/dashboard/department-form"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

export default async function DepartmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["main_admin"])
  
  const resolvedParams = await params

  const [department, allMembers, unassignedMembers] = await Promise.all([
    getDepartmentById(resolvedParams.id),
    // get everyone to filter locally (admin can see all)
    listTeamMembers(await requireRole(["main_admin"])),
    listUnassignedMembers()
  ])

  if (!department) {
    notFound()
  }

  // Filter members that belong to this department
  const departmentMembers = allMembers.filter(m => m.team_id === department.id)

  return (
    <>
      <div className="mb-4">
        <Link
          href="/dashboard/departments"
          className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Departments
        </Link>
      </div>

      <PageHeader
        title={department.name}
        description={department.description || "Manage this department's members and manager."}
      />

      <div className="grid gap-6 lg:gap-8 lg:grid-cols-[1fr_360px]">
        <DepartmentDetail 
          department={department} 
          members={departmentMembers} 
          unassignedMembers={unassignedMembers} 
        />
        <div className="space-y-4">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Edit Details
          </h2>
          <DepartmentForm department={department} />
        </div>
      </div>
    </>
  )
}
