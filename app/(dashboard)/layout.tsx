import { requireProfile } from "@/lib/auth"
import { DashboardSidebar } from "@/components/dashboard/sidebar"
import { TopBar } from "@/components/dashboard/top-bar"
import { MobileNav } from "@/components/dashboard/mobile-nav"

export const dynamic = "force-dynamic"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile()

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <DashboardSidebar role={profile.role} />

      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar
          name={profile.full_name ?? profile.email}
          email={profile.email}
          role={profile.role}
        />
        <main className="flex-1 px-4 lg:px-8 py-6 lg:py-8 pb-24 lg:pb-12 space-y-6 lg:space-y-8 min-w-0">
          {children}
        </main>
      </div>

      <MobileNav role={profile.role} />
    </div>
  )
}
