"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"
import type { SubmissionStatus } from "@/lib/types"

const FILTERS: { value: SubmissionStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "passed", label: "Passed" },
  { value: "needs_review", label: "Needs review" },
  { value: "failed", label: "Failed" },
  { value: "late_submitted", label: "Late" },
  { value: "missed", label: "Missed" },
  { value: "queued", label: "Queued" },
  { value: "validating", label: "Validating" },
]

export function SubmissionsFilter() {
  const pathname = usePathname()
  const params = useSearchParams()
  const current = params.get("status") ?? "all"

  return (
    <div role="tablist" aria-label="Filter submissions" className="flex flex-wrap gap-1.5">
      {FILTERS.map((f) => {
        const sp = new URLSearchParams(params.toString())
        if (f.value === "all") sp.delete("status")
        else sp.set("status", f.value)
        const href = `${pathname}${sp.toString() ? `?${sp.toString()}` : ""}`
        const active = current === f.value
        return (
          <Link
            key={f.value}
            href={href}
            role="tab"
            aria-selected={active}
            className={cn(
              "inline-flex items-center rounded-full px-3 py-1 text-[12px] font-semibold transition-colors",
              active
                ? "bg-foreground text-background"
                : "bg-warm-white text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {f.label}
          </Link>
        )
      })}
    </div>
  )
}
