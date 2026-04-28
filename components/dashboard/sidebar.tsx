"use client"

import { useState } from "react"
import {
  LayoutDashboard,
  Megaphone,
  FolderOpen,
  Upload,
  Sparkles,
  BarChart3,
  History,
  Users,
  Settings,
  ShieldCheck,
  ChevronDown,
} from "lucide-react"
import { cn } from "@/lib/utils"

type NavItem = {
  label: string
  icon: React.ComponentType<{ className?: string }>
  href: string
  badge?: string | number
  active?: boolean
}

type NavGroup = {
  label: string
  items: NavItem[]
}

const navGroups: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { label: "Overview", icon: LayoutDashboard, href: "#overview", active: true },
      { label: "Announcements", icon: Megaphone, href: "#announcements", badge: 3 },
      { label: "Materials", icon: FolderOpen, href: "#materials" },
      { label: "Submissions", icon: Upload, href: "#submissions", badge: 12 },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { label: "AI Insights", icon: Sparkles, href: "#insights" },
      { label: "Reports", icon: BarChart3, href: "#reports" },
      { label: "Activity Log", icon: History, href: "#activity" },
    ],
  },
  {
    label: "Administration",
    items: [
      { label: "Team Members", icon: Users, href: "#team" },
      { label: "Permissions", icon: ShieldCheck, href: "#permissions" },
      { label: "Settings", icon: Settings, href: "#settings" },
    ],
  },
]

export function DashboardSidebar() {
  const [teamOpen, setTeamOpen] = useState(true)

  return (
    <aside
      className="hidden lg:flex w-64 shrink-0 flex-col border-r border-border bg-sidebar h-screen sticky top-0"
      aria-label="Primary navigation"
    >
      {/* Brand */}
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
          <span className="text-[11px] font-medium text-muted-foreground">AI Hierarchy Portal</span>
        </div>
      </div>

      {/* Workspace switcher */}
      <button
        type="button"
        onClick={() => setTeamOpen((o) => !o)}
        className="mx-3 mt-3 flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2.5 text-left transition-colors hover:bg-muted"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#f2f9ff] text-[#097fe8] text-[12px] font-semibold">
            ND
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold truncate">North District Team</div>
            <div className="text-[11px] font-medium text-muted-foreground">Manager workspace</div>
          </div>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform shrink-0",
            teamOpen && "rotate-180",
          )}
        />
      </button>

      {/* Navigation groups */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 py-4 space-y-5">
        {navGroups.map((group) => (
          <div key={group.label}>
            <div className="px-2 mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {group.label}
            </div>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon
                return (
                  <li key={item.label}>
                    <a
                      href={item.href}
                      className={cn(
                        "group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[14px] font-medium transition-colors",
                        item.active
                          ? "bg-sidebar-accent text-foreground"
                          : "text-foreground/80 hover:bg-sidebar-accent hover:text-foreground",
                      )}
                      aria-current={item.active ? "page" : undefined}
                    >
                      <Icon
                        className={cn(
                          "h-[18px] w-[18px] shrink-0",
                          item.active ? "text-primary" : "text-muted-foreground",
                        )}
                      />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.badge !== undefined && (
                        <span className="rounded-full bg-[#f2f9ff] px-1.5 py-0.5 text-[11px] font-semibold leading-none text-[#097fe8] tracking-[0.125px]">
                          {item.badge}
                        </span>
                      )}
                    </a>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Storage / footer card */}
      <div className="m-3 rounded-xl border border-border bg-background p-3.5 shadow-card">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[12px] font-semibold">Storage</span>
          <span className="text-[11px] font-medium text-muted-foreground">68%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-[68%] rounded-full bg-primary" />
        </div>
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          136 GB of 200 GB used across submissions and materials.
        </p>
        <button
          type="button"
          className="mt-2.5 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px] font-semibold transition-colors hover:bg-muted"
        >
          Manage storage
        </button>
      </div>
    </aside>
  )
}
