"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useCallback, useMemo, useRef, useState } from "react"
import {
  Grid2x2,
  MoreHorizontal,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { UserRole } from "@/lib/types"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { getDashboardNavGroups, getDashboardNavItems } from "./navigation"

const PRIMARY_MOBILE_ROUTES = [
  "/dashboard",
  "/dashboard/tasks",
  "/dashboard/messages",
  "/dashboard/smart-ai",
] as const

export function MobileNav({ role, allowedHrefs }: { role: UserRole; allowedHrefs?: string[] }) {
  const pathname = usePathname()
  const router = useRouter()
  const [moreOpen, setMoreOpen] = useState(false)
  const navItems = useMemo(() => getDashboardNavItems(role, allowedHrefs), [allowedHrefs, role])
  const navGroups = useMemo(() => getDashboardNavGroups(role, allowedHrefs), [allowedHrefs, role])
  const primaryItems = useMemo(
    () => PRIMARY_MOBILE_ROUTES
      .map((href) => navItems.find((item) => item.href === href))
      .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    [navItems],
  )
  const moreGroups = useMemo(
    () => navGroups
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) => !primaryItems.some((primaryItem) => primaryItem.href === item.href),
        ),
      }))
      .filter((group) => group.items.length > 0),
    [navGroups, primaryItems],
  )
  const moreActive = moreGroups.some((group) =>
    group.items.some((item) => item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href)),
  )

  // De-dupe prefetches per route so a quick scrub across the bar doesn't
  // trigger N redundant RSC fetches.
  const warmed = useRef<Set<string>>(new Set())
  const warm = useCallback(
    (href: string) => {
      if (warmed.current.has(href)) return
      warmed.current.add(href)
      try {
        router.prefetch(href)
      } catch {
        // Prefetch is best-effort.
      }
    },
    [router],
  )

  return (
    <>
      <nav
        aria-label="Primary mobile navigation"
        className="lg:hidden fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur-md"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul
          className="grid"
          style={{ gridTemplateColumns: `repeat(${primaryItems.length + 1}, minmax(0, 1fr))` }}
        >
          {primaryItems.map((item) => {
            const Icon = item.icon
            const active =
              item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onTouchStart={() => warm(item.href)}
                  onFocus={() => warm(item.href)}
                  className={cn(
                    "flex flex-col items-center gap-0.5 py-2.5 text-[10.5px] font-semibold",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                  {item.label === "Overview" ? "Home" : item.label}
                </Link>
              </li>
            )
          })}
          <li>
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              aria-label="Open full navigation"
              onClick={() => setMoreOpen(true)}
              className={cn(
                "flex w-full flex-col items-center gap-0.5 py-2.5 text-[10.5px] font-semibold",
                moreActive ? "text-primary" : "text-muted-foreground",
              )}
            >
              <MoreHorizontal className="h-4.5 w-4.5" aria-hidden="true" />
              More
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="left" className="w-[88vw] max-w-90 gap-0 p-0">
          <SheetHeader className="border-b border-border pb-4 pr-12">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            {navGroups.map((group) => (
              <div key={group.label} className="py-3 first:pt-2">
                <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  {group.label}
                </p>
                <ul className="space-y-1">
                  {group.items.map((item) => {
                    const Icon = item.icon
                    const active =
                      item.href === "/dashboard"
                        ? pathname === "/dashboard"
                        : pathname.startsWith(item.href)
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          onClick={() => setMoreOpen(false)}
                          onTouchStart={() => warm(item.href)}
                          onFocus={() => warm(item.href)}
                          className={cn(
                            "flex items-center gap-3 rounded-xl px-3 py-3 text-[14px] font-medium transition-colors",
                            active
                              ? "bg-accent text-accent-foreground"
                              : "text-foreground/80 hover:bg-muted hover:text-foreground",
                          )}
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                            <Icon className="h-4 w-4" aria-hidden="true" />
                          </span>
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                          {active ? <Grid2x2 className="h-4 w-4 text-primary" aria-hidden="true" /> : null}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
