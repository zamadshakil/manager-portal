"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Activity, ArrowLeft, ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"

const TABS = [
  { href: "/system-monitor", label: "Overview", exact: true },
  { href: "/system-monitor/issues", label: "Issues", exact: false },
  { href: "/system-monitor/performance", label: "Performance", exact: false },
  { href: "/system-monitor/requests", label: "Request Logs", exact: false },
  { href: "/system-monitor/errors", label: "Error Logs", exact: false },
]

export default function SystemLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 lg:px-8">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <Activity className="h-5 w-5 text-primary" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[15px] font-semibold tracking-tight">System Monitor</h1>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600">
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                main_admin only
              </span>
            </div>
            <p className="truncate text-[11px] text-muted-foreground">
              Technical observability dashboard for logs, issues, latency, and health.
            </p>
          </div>

          <Link
            href="/dashboard"
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Manager portal
          </Link>
        </div>

        <nav
          aria-label="System monitor sections"
          className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-4 lg:px-8"
        >
          {TABS.map((tab) => {
            const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href)
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "relative whitespace-nowrap px-3 py-2.5 text-[13px] font-medium transition-colors",
                  active
                    ? "text-foreground after:absolute after:bottom-0 after:inset-x-0 after:h-0.5 after:rounded-t after:bg-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-current={active ? "page" : undefined}
              >
                {tab.label}
              </Link>
            )
          })}
        </nav>
      </header>

      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 lg:px-8 lg:py-8">
        {children}
      </main>
    </div>
  )
}
