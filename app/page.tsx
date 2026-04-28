import { DashboardSidebar } from "@/components/dashboard/sidebar"
import { TopBar } from "@/components/dashboard/top-bar"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatCards } from "@/components/dashboard/stat-cards"
import { Announcements } from "@/components/dashboard/announcements"
import { SubmissionsTable } from "@/components/dashboard/submissions-table"
import { AIInsights } from "@/components/dashboard/ai-insights"
import { ActivityLog } from "@/components/dashboard/activity-log"
import { Materials } from "@/components/dashboard/materials"
import { ReportsChart } from "@/components/dashboard/reports-chart"
import { UploadCard } from "@/components/dashboard/upload-card"
import { TeamPerformance } from "@/components/dashboard/team-performance"
import { MobileNav } from "@/components/dashboard/mobile-nav"

export default function DashboardPage() {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <DashboardSidebar />

      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar />

        <main className="flex-1 px-4 lg:px-8 py-6 lg:py-8 pb-24 lg:pb-12 space-y-6 lg:space-y-8">
          <PageHeader />

          <StatCards />

          {/* Two-column intelligence + submissions row */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 lg:gap-8">
            <div className="xl:col-span-2 space-y-6 lg:space-y-8 min-w-0">
              <SubmissionsTable />
              <ReportsChart />
            </div>
            <div className="space-y-6 lg:space-y-8 min-w-0">
              <UploadCard />
              <AIInsights />
              <TeamPerformance />
            </div>
          </div>

          {/* Announcements + Activity */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 lg:gap-8">
            <div className="xl:col-span-2">
              <Announcements />
            </div>
            <ActivityLog />
          </div>

          {/* Materials full-width */}
          <Materials />

          <footer className="pt-4 text-[12px] font-medium text-muted-foreground flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-t border-border">
            <span className="pt-4">
              Hierarchia · AI-Driven Hierarchy Portal · Daily master summary auto-dispatched at
              18:00 UTC
            </span>
            <span className="pt-4">v2.4.1 · Last sync 30 seconds ago</span>
          </footer>
        </main>
      </div>

      <MobileNav />
    </div>
  )
}
