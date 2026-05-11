"use client"

import { cn } from "@/lib/utils"

const FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "passed", label: "Passed" },
  { value: "needs_review", label: "Need Review" },
  { value: "failed", label: "Failed" },
]

interface SubmissionsFilterProps {
  value: string
  onChange: (value: string) => void
}

export function SubmissionsFilter({ value, onChange }: SubmissionsFilterProps) {
  return (
    <div role="tablist" aria-label="Filter submissions" className="flex flex-wrap gap-1.5">
      {FILTERS.map((f) => {
        const active = value === f.value
        return (
          <button
            key={f.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(f.value)}
            className={cn(
              "inline-flex items-center rounded-full px-3 py-1 text-[12px] font-semibold transition-colors",
              active
                ? "bg-foreground text-background"
                : "bg-warm-white text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        )
      })}
    </div>
  )
}
