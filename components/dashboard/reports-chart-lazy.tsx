"use client"

import dynamic from "next/dynamic"
import type { ComponentProps } from "react"
import type { ReportsChart as ReportsChartType } from "@/components/dashboard/reports-chart"

/**
 * `next/dynamic` lazy boundary for the Recharts-powered Reports view.
 *
 * Recharts plus its d3 sub-deps weighs in around 150 KB gzipped. Importing
 * it directly from a server component pulls it into the initial bundle of
 * every dashboard page that even *transitively* references the reports
 * route, slowing first paint everywhere. Wrapping the import in
 * `next/dynamic` keeps Recharts out of the shared chunk and only ships it
 * when the user actually opens /dashboard/reports.
 *
 * `ssr: false` is intentional — the chart is purely interactive and a
 * server-rendered version of the SVG would be invalidated by hydration
 * within milliseconds anyway. The skeleton below preserves the shape of
 * the section so the layout doesn't jump on first paint.
 */
const ReportsChart = dynamic(
  () => import("@/components/dashboard/reports-chart").then((m) => m.ReportsChart),
  {
    ssr: false,
    loading: () => (
      <section
        aria-busy="true"
        aria-live="polite"
        className="rounded-xl border border-border bg-card shadow-card"
      >
        <header className="flex flex-col gap-3 px-5 py-4 border-b border-border md:flex-row md:items-center md:justify-between">
          <div className="space-y-1.5">
            <div className="h-5 w-44 rounded-md bg-muted animate-pulse" />
            <div className="h-3 w-56 rounded-md bg-muted animate-pulse" />
          </div>
          <div className="h-9 w-44 rounded-xl bg-muted animate-pulse" />
        </header>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border border-b border-border">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-card px-5 py-3.5 space-y-2">
              <div className="h-3 w-12 rounded bg-muted animate-pulse" />
              <div className="h-6 w-20 rounded bg-muted animate-pulse" />
            </div>
          ))}
        </div>
        <div className="p-5">
          <div className="h-64 rounded-lg bg-muted animate-pulse" />
        </div>
      </section>
    ),
  },
)

export function ReportsChartLazy(props: ComponentProps<typeof ReportsChartType>) {
  return <ReportsChart {...props} />
}
