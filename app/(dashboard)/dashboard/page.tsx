import { requireProfile } from "@/lib/auth"
import {
  getDashboardSummary,
  listAnnouncements,
  listMaterials,
  listActivity,
} from "@/lib/data"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatCards } from "@/components/dashboard/stat-cards"
import { SubmissionsTable } from "@/components/dashboard/submissions-table"
import { Announcements } from "@/components/dashboard/announcements"
import { Materials } from "@/components/dashboard/materials"
import { ActivityLog } from "@/components/dashboard/activity-log"
import { UploadCard } from "@/components/dashboard/upload-card"
import { roleLabel } from "@/lib/auth-shared"

export const dynamic = "force-dynamic"

export default async function OverviewPage() {
  const profile = await requireProfile()
  const [summary, announcements, materials, activity] = await Promise.all([
    getDashboardSummary(profile),
    listAnnouncements(profile, 5),
    listMaterials(profile, 6),
    profile.role !== "member" ? listActivity(profile, 8) : Promise.resolve([]),
  ])

  const greeting = profile.full_name?.split(" ")[0] ?? profile.email
  const roleline =
    profile.role === "main_admin"
      ? "Main Admin overview — every team, every submission, every action."
      : profile.role === "manager"
        ? "Manager view — submissions, members, and validation insights for your team."
        : "Welcome back. Here's the latest from your team."

  return (
    <>
      <PageHeader
        title={`Hello, ${greeting}`}
        description={roleline}
        action={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-warm-white px-3 py-1.5 text-[12px] font-semibold text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-[#1aae39]" aria-hidden="true" />
            Signed in as {roleLabel(profile.role)}
          </span>
        }
      />

      <StatCards
        total={summary.total}
        passRate={summary.passRate}
        avgScore={summary.avgScore}
        needsReview={summary.needsReview}
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 lg:gap-6">
        <div className="xl:col-span-2 space-y-4 lg:space-y-6 min-w-0">
          {profile.role === "member" ? <UploadCard /> : null}
          <SubmissionsTable rows={summary.recent} />
          <Materials rows={materials} />
        </div>
        <div className="space-y-4 lg:space-y-6 min-w-0">
          <Announcements rows={announcements} />
          {profile.role !== "member" ? <ActivityLog rows={activity} /> : null}
        </div>
      </div>
    </>
  )
}
