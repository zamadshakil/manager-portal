import {
  BarChart3,
  BrainCircuit,
  FolderOpen,
  History,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Megaphone,
  MessageSquare,
  Settings,
  ShieldCheck,
  Sparkles,
  Upload,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react"
import type { UserRole } from "@/lib/types"

export interface DashboardNavItem {
  label: string
  icon: LucideIcon
  href: string
  roles: UserRole[]
}

export interface DashboardNavGroup {
  label: string
  items: DashboardNavItem[]
}

export const dashboardNavGroups: DashboardNavGroup[] = [
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
        label: "Messages",
        icon: MessageSquare,
        href: "/dashboard/messages",
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
        label: "My AI Credits",
        icon: Zap,
        href: "/dashboard/my-credits",
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
        label: "My Department",
        icon: Users,
        href: "/dashboard/my-department",
        roles: ["manager", "member"],
      },
      {
        label: "Departments",
        icon: Users,
        href: "/dashboard/departments",
        roles: ["main_admin"],
      },
      {
        label: "Access Control",
        icon: KeyRound,
        href: "/dashboard/permissions",
        roles: ["main_admin"],
      },
      {
        label: "AI & Usage",
        icon: BrainCircuit,
        href: "/dashboard/ai-usage",
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

export function getDashboardNavGroups(role: UserRole, allowedHrefs?: string[]): DashboardNavGroup[] {
  const allowedHrefSet = allowedHrefs ? new Set(allowedHrefs) : null
  return dashboardNavGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        allowedHrefSet ? allowedHrefSet.has(item.href) : item.roles.includes(role),
      ),
    }))
    .filter((group) => group.items.length > 0)
}

export function getDashboardNavItems(role: UserRole, allowedHrefs?: string[]): DashboardNavItem[] {
  return getDashboardNavGroups(role, allowedHrefs).flatMap((group) => group.items)
}
