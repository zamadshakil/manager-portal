import { redirect } from "next/navigation"
import { requireProfile } from "@/lib/auth"
import { getMyDepartmentView } from "@/lib/data"
import { PageHeader } from "@/components/dashboard/page-header"
import { MyDepartmentView } from "@/components/dashboard/my-department-view"

export const dynamic = "force-dynamic"

export default async function MyDepartmentPage() {
  const profile = await requireProfile()

  // main_admin manages departments from their own page
  if (profile.role === "main_admin") {
    redirect("/dashboard/departments")
  }

  if (!profile.team_id) {
    return (
      <>
        <PageHeader
          title="My Department"
          description="View your department and fellow team members."
        />
        <div className="rounded-xl border border-border bg-card p-10 text-center shadow-card">
          <p className="text-[14px] font-semibold">You are not assigned to any department.</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Contact your administrator to be added to a department.
          </p>
        </div>
      </>
    )
  }

  const view = await getMyDepartmentView(profile.team_id)

  if (!view) {
    return (
      <>
        <PageHeader
          title="My Department"
          description="View your department and fellow team members."
        />
        <div className="rounded-xl border border-border bg-card p-10 text-center shadow-card">
          <p className="text-[14px] font-semibold">Department not found.</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Contact your administrator if you believe this is an error.
          </p>
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="My Department"
        description="Your department info, manager, and fellow team members."
      />
      <div className="max-w-2xl">
        <MyDepartmentView view={view} currentProfileId={profile.id} />
      </div>
    </>
  )
}
