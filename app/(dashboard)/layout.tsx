import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { requireProfile } from "@/lib/auth"
import { CAPABILITIES, getAccessContext } from "@/lib/permissions"
import { DashboardSidebar } from "@/components/dashboard/sidebar"
import { TopBar } from "@/components/dashboard/top-bar"
import { MobileNav } from "@/components/dashboard/mobile-nav"

const PASSWORD_RESET_PATH = "/dashboard/settings"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // requireProfile() is wrapped in React.cache, so this single call is
  // shared with whatever inner page also calls requireProfile()/requireRole().
  // No more duplicate auth.getUser() + profile selects per navigation.
  const profile = await requireProfile()
  const ctx = await getAccessContext(profile)

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

  const allowedHrefs = [
    "/dashboard",
    "/dashboard/submissions",
    "/dashboard/messages",
    ...(ctx.has(CAPABILITIES.SMART_AI_CHAT) ? ["/dashboard/smart-ai"] : []),
    "/dashboard/settings",
    ...(ctx.has(CAPABILITIES.TASKS_READ) || ctx.has(CAPABILITIES.TASKS_CREATE) || ctx.has(CAPABILITIES.TASKS_ASSIGN) || ctx.has(CAPABILITIES.TASKS_DELETE)
      ? ["/dashboard/tasks"]
      : []),
    ...(ctx.has(CAPABILITIES.ANNOUNCEMENTS_READ) || ctx.has(CAPABILITIES.ANNOUNCEMENTS_CREATE) || ctx.has(CAPABILITIES.ANNOUNCEMENTS_DELETE)
      ? ["/dashboard/announcements"]
      : []),
    ...(ctx.has(CAPABILITIES.MATERIALS_READ) || ctx.has(CAPABILITIES.MATERIALS_CREATE) || ctx.has(CAPABILITIES.MATERIALS_DELETE)
      ? ["/dashboard/materials"]
      : []),
    ...(ctx.has(CAPABILITIES.VALIDATION_RULES_READ) ? ["/dashboard/rules"] : []),
    ...(profile.role === "main_admin" || profile.role === "manager" ? ["/dashboard/reports", "/dashboard/activity"] : []),
    ...(profile.role === "main_admin"
      || profile.role === "manager"
      || ctx.has(CAPABILITIES.TEAM_MANAGEMENT_READ)
      || ctx.has(CAPABILITIES.TEAM_MANAGEMENT_WRITE)
      || ctx.has(CAPABILITIES.USER_MANAGEMENT_READ)
      || ctx.has(CAPABILITIES.USER_MANAGEMENT_WRITE)
      ? ["/dashboard/team"]
      : []),
    ...(profile.role === "manager" || profile.role === "member" ? ["/dashboard/my-department"] : []),
    ...(profile.role === "main_admin" ? ["/dashboard/departments", "/dashboard/permissions", "/dashboard/ai-usage"] : []),
    ...(profile.role !== "main_admin" && ctx.has(CAPABILITIES.AI_CREDITS_READ_SELF) ? ["/dashboard/my-credits"] : []),
  ]

  const primaryAction = profile.role === "main_admin"
    ? { href: "/dashboard/team?tab=provisioning", label: "Add user" }
    : ctx.has(CAPABILITIES.TASKS_CREATE)
      ? { href: "/dashboard/tasks", label: "Assign task" }
      : { href: "/dashboard/tasks", label: "Open tasks" }

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <DashboardSidebar role={profile.role} allowedHrefs={allowedHrefs} />

      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <TopBar
          name={profile.full_name ?? profile.email}
          email={profile.email}
          role={profile.role}
          avatarUrl={profile.avatar_url}
          primaryAction={primaryAction}
        />
        <main className="flex-1 min-h-0 overflow-y-auto flex flex-col px-4 lg:px-8 py-6 lg:py-8 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-12 space-y-6 lg:space-y-8 min-w-0">
          {children}
        </main>
      </div>

      <MobileNav role={profile.role} allowedHrefs={allowedHrefs} />
    </div>
  )
}
