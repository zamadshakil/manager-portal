import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { requireProfile } from "@/lib/auth"
import { DashboardSidebar } from "@/components/dashboard/sidebar"
import { TopBar } from "@/components/dashboard/top-bar"
import { MobileNav } from "@/components/dashboard/mobile-nav"

const PASSWORD_RESET_PATH = "/dashboard/settings"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // requireProfile() is wrapped in React.cache, so this single call is
  // shared with whatever inner page also calls requireProfile()/requireRole().
  // No more duplicate auth.getUser() + profile selects per navigation.
  const profile = await requireProfile()

  // First-login password reset: previously enforced in the edge proxy via a
  // dedicated DB query on EVERY request. Moved here so the proxy stays
  // network-light. Pathname comes from the `x-pathname` header set by the
  // proxy because Next does not expose pathname directly in server layouts.
  if (profile.must_reset) {
    const h = await headers()
    const pathname = h.get("x-pathname") ?? ""
    if (!pathname.startsWith(PASSWORD_RESET_PATH)) {
      redirect(`${PASSWORD_RESET_PATH}?reset=1`)
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <DashboardSidebar role={profile.role} />

      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <TopBar
          name={profile.full_name ?? profile.email}
          email={profile.email}
          role={profile.role}
          avatarUrl={profile.avatar_url}
        />
        <main className="flex-1 min-h-0 overflow-y-auto flex flex-col px-4 lg:px-8 py-6 lg:py-8 pb-24 lg:pb-12 space-y-6 lg:space-y-8 min-w-0">
          {children}
        </main>
      </div>

      <MobileNav role={profile.role} />
    </div>
  )
}
