"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

const TABS = [
  { href: "/dashboard/system", label: "Overview", exact: true },
  { href: "/dashboard/system/requests", label: "Request Logs", exact: false },
  { href: "/dashboard/system/errors", label: "Error Logs", exact: false },
]

export default function SystemLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="flex flex-col gap-6">
      <nav
        aria-label="System monitor sections"
        className="flex items-center gap-1 border-b border-border -mx-4 lg:-mx-8 px-4 lg:px-8"
      >
        {TABS.map((tab) => {
          const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "relative px-3 py-2.5 text-[13px] font-medium transition-colors",
                active
                  ? "text-foreground after:absolute after:bottom-0 after:inset-x-0 after:h-0.5 after:bg-primary after:rounded-t"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-current={active ? "page" : undefined}
            >
              {tab.label}
            </Link>
          )
        })}
      </nav>
      {children}
    </div>
  )
}
