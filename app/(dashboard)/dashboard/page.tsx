import { Suspense } from "react"
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
import type { Profile } from "@/lib/types"

// ---------------------------------------------------------------------------
// Streaming dashboard overview
//
// Each section below is its own async Server Component wrapped in Suspense,
// so the page shell paints immediately and each region streams in as its own
// data resolves — instead of blocking on the slowest of five queries via
// Promise.all. StatCards and RecentSubmissions both call the cached
// getDashboardSummary, so they share one round-trip.
// ---------------------------------------------------------------------------

export default async function OverviewPage() {
  const profile = await requireProfile()

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

      <Suspense fallback={<StatCardsSkeleton />}>
        <StatCardsSection profile={profile} />
      </Suspense>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 lg:gap-6">
        <div className="xl:col-span-2 space-y-4 lg:space-y-6 min-w-0">
          {profile.role === "member" ? (
            <Suspense fallback={null}>
              <OpenTasksSection profile={profile} />
            </Suspense>
          ) : null}
          <Suspense fallback={<TableSkeleton />}>
            <RecentSubmissionsSection profile={profile} />
          </Suspense>
          <Suspense fallback={<TableSkeleton />}>
            <MaterialsSection profile={profile} />
          </Suspense>
        </div>
        <div className="space-y-4 lg:space-y-6 min-w-0">
          <Suspense fallback={<PanelSkeleton />}>
            <AnnouncementsSection profile={profile} />
          </Suspense>
          {profile.role !== "member" ? (
            <Suspense fallback={<PanelSkeleton />}>
              <ActivitySection profile={profile} />
            </Suspense>
          ) : null}
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

async function StatCardsSection({ profile }: { profile: Profile }) {
  const summary = await getDashboardSummary(profile)
  return (
    <StatCards
      total={summary.total}
      passRate={summary.passRate}
      avgScore={summary.avgScore}
      needsReview={summary.needsReview}
    />
  )
}

async function RecentSubmissionsSection({ profile }: { profile: Profile }) {
  // Reuses the React.cache'd summary — no second query.
  const summary = await getDashboardSummary(profile)
  const canDelete = profile.role === "manager" || profile.role === "main_admin"
  return <SubmissionsTable rows={summary.recent} canDelete={canDelete} />
}

async function MaterialsSection({ profile }: { profile: Profile }) {
  const rows = await listMaterials(profile, 6)
  return <Materials rows={rows} showViewAll />
}

async function AnnouncementsSection({ profile }: { profile: Profile }) {
  const rows = await listAnnouncements(profile, 5)
  return <Announcements rows={rows} showViewAll />
}

async function ActivitySection({ profile }: { profile: Profile }) {
  const rows = await listActivity(profile, 8)
  return <ActivityLog rows={rows} />
}

async function OpenTasksSection({ profile }: { profile: Profile }) {
  const myTasks = await listMyTasks(profile)
  const openTasks = myTasks.filter((t) => t.status === "assigned")
  if (openTasks.length === 0) return null
  return (
    <section>
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted-foreground mb-3">
        Open tasks ({openTasks.length})
      </h2>
      <MyTasks tasks={openTasks.slice(0, 3)} />
    </section>
  )
}

// ---------------------------------------------------------------------------
// Skeleton fallbacks (kept inline to avoid a new file for one-off shapes)
// ---------------------------------------------------------------------------

function StatCardsSkeleton() {
  return (
    <section
      aria-hidden="true"
      className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 animate-pulse"
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-border bg-card p-4 lg:p-5 shadow-card h-[112px]"
        />
      ))}
    </section>
  )
}

function TableSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="rounded-xl border border-border bg-card shadow-card h-72 animate-pulse"
    />
  )
}

function PanelSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="rounded-xl border border-border bg-card shadow-card h-64 animate-pulse"
    />
  )
}
