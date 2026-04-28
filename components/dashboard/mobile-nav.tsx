"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, Upload, Megaphone, FolderOpen, BarChart3, ListChecks } from "lucide-react"
import { cn } from "@/lib/utils"
import type { UserRole } from "@/lib/types"

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  roles: UserRole[]
}

const items: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard, roles: ["main_admin", "manager", "member"] },
  { href: "/dashboard/tasks", label: "Tasks", icon: ListChecks, roles: ["main_admin", "manager", "member"] },
  { href: "/dashboard/submissions", label: "Submissions", icon: Upload, roles: ["main_admin", "manager", "member"] },
  { href: "/dashboard/announcements", label: "News", icon: Megaphone, roles: ["main_admin", "manager", "member"] },
  { href: "/dashboard/reports", label: "Reports", icon: BarChart3, roles: ["main_admin", "manager"] },
]

export function MobileNav({ role }: { role: UserRole }) {
  const pathname = usePathname()
  const visible = items.filter((i) => i.roles.includes(role))

  return (
    <nav
      aria-label="Primary mobile navigation"
      className="lg:hidden fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur-md"
    >
      <ul
        className="grid"
        style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))` }}
      >
        {visible.map((item) => {
          const Icon = item.icon
          const active =
            item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href)
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-0.5 py-2.5 text-[10.5px] font-semibold",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
