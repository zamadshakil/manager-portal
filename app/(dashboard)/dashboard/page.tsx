import { requireProfile } from "@/lib/auth"
import {
  getDashboardSummary,
  listAnnouncements,
  listMaterials,
  listActivity,
  listMyTasks,
} from "@/lib/data"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatCards } from "@/components/dashboard/stat-cards"
import { SubmissionsTable } from "@/components/dashboard/submissions-table"
import { Announcements } from "@/components/dashboard/announcements"
import { Materials } from "@/components/dashboard/materials"
import { ActivityLog } from "@/components/dashboard/activity-log"
import { MyTasks } from "@/components/dashboard/my-tasks"
import { roleLabel } from "@/lib/auth-shared"

export default async function OverviewPage() {
  const profile = await requireProfile()
  const [summary, announcements, materials, activity, myTasks] = await Promise.all([
    getDashboardSummary(profile),
    listAnnouncements(profile, 5),
    listMaterials(profile, 6),
    profile.role !== "member" ? listActivity(profile, 8) : Promise.resolve([]),
    profile.role === "member" ? listMyTasks(profile) : Promise.resolve([]),
  ])

  const openTasks = myTasks.filter((t) => t.status === "assigned")

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
          {profile.role === "member" && openTasks.length > 0 ? (
            <section>
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted-foreground mb-3">
                Open tasks ({openTasks.length})
              </h2>
              <MyTasks tasks={openTasks.slice(0, 3)} />
            </section>
          ) : null}
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
