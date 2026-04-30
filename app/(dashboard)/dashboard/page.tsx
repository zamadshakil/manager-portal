import { Suspense } from "react"
import { requireProfile } from "@/lib/auth"
import {
  getDashboardSummary,
  listAnnouncements,
  listMaterials,
  listActivity,
  listMyTasks,
} from "@/lib/data"
import type { Profile } from "@/lib/types"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatCards } from "@/components/dashboard/stat-cards"
import { SubmissionsTable } from "@/components/dashboard/submissions-table"
import { Announcements } from "@/components/dashboard/announcements"
import { Materials } from "@/components/dashboard/materials"
import { ActivityLog } from "@/components/dashboard/activity-log"
import { MyTasks } from "@/components/dashboard/my-tasks"
import { roleLabel } from "@/lib/auth-shared"

/**
 * Dashboard overview.
 *
 * Each card on this page fetches its own data inside its own `<Suspense>`
 * boundary. The benefit:
 *   1. The shell (PageHeader + greeting + grid skeleton) paints in <50 ms.
 *   2. The remaining sections stream in parallel and render as soon as
 *      their individual queries resolve. A slow announcements query no
 *      longer blocks fast metrics from showing up.
 *   3. `getDashboardSummary` is wrapped in `React.cache`, so the StatCards
 *      and RecentSubmissions sections share a single network round-trip.
 */
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
            <Suspense fallback={<CardSkeleton lines={3} />}>
              <MyTasksSection profile={profile} />
            </Suspense>
          ) : null}

          <Suspense fallback={<TableSkeleton rows={6} />}>
            <RecentSubmissionsSection profile={profile} />
          </Suspense>

          <Suspense fallback={<CardSkeleton lines={4} />}>
            <MaterialsSection profile={profile} />
          </Suspense>
        </div>

        <div className="space-y-4 lg:space-y-6 min-w-0">
          <Suspense fallback={<CardSkeleton lines={4} />}>
            <AnnouncementsSection profile={profile} />
          </Suspense>

          {profile.role !== "member" ? (
            <Suspense fallback={<CardSkeleton lines={6} />}>
              <ActivitySection profile={profile} />
            </Suspense>
          ) : null}
        </div>
      </div>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Suspended sections — each one is its own server component, each one
/* fetches independently, each one streams when ready.                        */
/* -------------------------------------------------------------------------- */

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
  // Re-uses the same `getDashboardSummary` call that fed StatCardsSection
  // thanks to `React.cache` — only one set of queries actually runs.
  const summary = await getDashboardSummary(profile)
  return <SubmissionsTable rows={summary.recent} />
}

async function MaterialsSection({ profile }: { profile: Profile }) {
  const rows = await listMaterials(profile, 6)
  return <Materials rows={rows} />
}

async function AnnouncementsSection({ profile }: { profile: Profile }) {
  const rows = await listAnnouncements(profile, 5)
  return <Announcements rows={rows} />
}

async function ActivitySection({ profile }: { profile: Profile }) {
  const rows = await listActivity(profile, 8)
  return <ActivityLog rows={rows} />
}

async function MyTasksSection({ profile }: { profile: Profile }) {
  const myTasks = await listMyTasks(profile)
  const open = myTasks.filter((t) => t.status === "assigned").slice(0, 3)
  if (open.length === 0) return null
  return (
    <section>
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted-foreground mb-3">
        Open tasks ({open.length})
      </h2>
      <MyTasks tasks={open} />
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Lightweight, layout-shape-matching skeletons. Tailwind only, no JS.        */
/* -------------------------------------------------------------------------- */

function StatCardsSkeleton() {
  return (
    <section
      aria-hidden="true"
      className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4"
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-border bg-card p-4 lg:p-5 shadow-card"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="h-3 w-24 rounded bg-muted animate-pulse" />
            <div className="h-7 w-7 rounded-lg bg-muted animate-pulse" />
          </div>
          <div className="mt-4 h-7 w-16 rounded bg-muted animate-pulse" />
          <div className="mt-2 h-3 w-28 rounded bg-muted animate-pulse" />
        </div>
      ))}
    </section>
  )
}

function CardSkeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div
      aria-hidden="true"
      className="rounded-xl border border-border bg-card p-4 lg:p-5 shadow-card"
    >
      <div className="h-4 w-32 rounded bg-muted animate-pulse" />
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="h-3 w-full rounded bg-muted animate-pulse" />
        ))}
      </div>
    </div>
  )
}

function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div
      aria-hidden="true"
      className="rounded-xl border border-border bg-card shadow-card overflow-hidden"
    >
      <div className="px-4 lg:px-5 py-3 border-b border-border">
        <div className="h-4 w-40 rounded bg-muted animate-pulse" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 lg:px-5 py-3">
            <div className="h-8 w-8 rounded-lg bg-muted animate-pulse" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
              <div className="h-3 w-1/3 rounded bg-muted animate-pulse" />
            </div>
            <div className="h-5 w-16 rounded-full bg-muted animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  )
}
