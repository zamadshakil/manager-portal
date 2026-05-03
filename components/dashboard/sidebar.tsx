"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useCallback, useRef } from "react"
import {
  LayoutDashboard,
  Megaphone,
  FolderOpen,
  Upload,
  BarChart3,
  History,
  Users,
  Settings,
  ShieldCheck,
  ListChecks,
  Sparkles,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { roleLabel } from "@/lib/auth-shared"
import type { UserRole } from "@/lib/types"

type NavItem = {
  label: string
  icon: React.ComponentType<{ className?: string }>
  href: string
  roles: UserRole[]
}

type NavGroup = {
  label: string
  items: NavItem[]
}

const NAV: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      {
        label: "Overview",
        icon: LayoutDashboard,
        href: "/dashboard",
        roles: ["main_admin", "manager", "member"],
      },
      {
        label: "Tasks",
        icon: ListChecks,
        href: "/dashboard/tasks",
        roles: ["main_admin", "manager", "member"],
      },
      {
        label: "Submissions",
        icon: Upload,
        href: "/dashboard/submissions",
        roles: ["main_admin", "manager", "member"],
      },
      {
        label: "Announcements",
        icon: Megaphone,
        href: "/dashboard/announcements",
        roles: ["main_admin", "manager", "member"],
      },
      {
        label: "Materials",
        icon: FolderOpen,
        href: "/dashboard/materials",
        roles: ["main_admin", "manager", "member"],
      },
    ],
  },
  {
    label: "Intelligence",
    items: [
      {
        label: "Smart AI",
        icon: Sparkles,
        href: "/dashboard/smart-ai",
        roles: ["main_admin", "manager", "member"],
      },
      {
        label: "Reports",
        icon: BarChart3,
        href: "/dashboard/reports",
        roles: ["main_admin", "manager"],
      },
      {
        label: "Activity Log",
        icon: History,
        href: "/dashboard/activity",
        roles: ["main_admin", "manager"],
      },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        label: "Validation Rules",
        icon: ShieldCheck,
        href: "/dashboard/rules",
        roles: ["main_admin", "manager"],
      },
      {
        label: "Team Members",
        icon: Users,
        href: "/dashboard/team",
        roles: ["main_admin", "manager"],
      },
      {
        label: "Departments",
        icon: Users,
        href: "/dashboard/departments",
        roles: ["main_admin"],
      },
      {
        label: "Settings",
        icon: Settings,
        href: "/dashboard/settings",
        roles: ["main_admin", "manager", "member"],
      },
    ],
  },
]

export function DashboardSidebar({ role }: { role: UserRole }) {
  const pathname = usePathname()
  const router = useRouter()

  // Track which routes we've already warmed in this session so a single
  // hover or focus only triggers one prefetch per route per page.
  const warmed = useRef<Set<string>>(new Set())
  const warm = useCallback(
    (href: string) => {
      if (warmed.current.has(href)) return
      warmed.current.add(href)
      try {
        router.prefetch(href)
      } catch {
        // prefetch is best-effort — never let it break navigation.
      }
    },
    [router],
  )

  return (
    <aside
      className="hidden lg:flex w-64 shrink-0 flex-col border-r border-border bg-sidebar h-screen sticky top-0"
      aria-label="Primary navigation"
    >
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-border">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-background">
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
            <path
              d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z"
              fill="currentColor"
            />
          </svg>
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-[15px] font-semibold tracking-[-0.25px]">Hierarchia</span>
          <span className="text-[11px] font-medium text-muted-foreground">{roleLabel(role)}</span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 py-4 space-y-5">
        {NAV.map((group) => {
          const items = group.items.filter((i) => i.roles.includes(role))
          if (items.length === 0) return null
          return (
            <div key={group.label}>
              <div className="px-2 mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                {group.label}
              </div>
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const Icon = item.icon
                  const active =
                    item.href === "/dashboard"
                      ? pathname === "/dashboard"
                      : pathname.startsWith(item.href)
                  return (
                    <li key={item.label}>
                      <Link
                        href={item.href}
                        onMouseEnter={() => warm(item.href)}
                        onFocus={() => warm(item.href)}
                        className={cn(
                          "group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[14px] font-medium transition-colors",
                          active
                            ? "bg-sidebar-accent text-foreground"
                            : "text-foreground/80 hover:bg-sidebar-accent hover:text-foreground",
                        )}
                        aria-current={active ? "page" : undefined}
                      >
                        <Icon
                          className={cn(
                            "h-[18px] w-[18px] shrink-0",
                            active ? "text-primary" : "text-muted-foreground",
                          )}
                        />
                        <span className="flex-1 truncate">{item.label}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </nav>

      <div className="m-3 rounded-xl border border-border bg-background p-3.5 shadow-card">
        <p className="text-[12px] font-semibold mb-1">Need help?</p>
        <p className="text-[11px] leading-snug text-muted-foreground">
          Contact your administrator to update access, reset credentials, or manage validation
          rules.
        </p>
      </div>
    </aside>
  )
}
