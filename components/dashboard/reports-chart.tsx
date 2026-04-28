"use client"

import { useState } from "react"
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts"
import { CalendarDays, Download } from "lucide-react"
import { cn } from "@/lib/utils"

const dataDay = [
  { label: "Mon", submissions: 38, validated: 34 },
  { label: "Tue", submissions: 52, validated: 49 },
  { label: "Wed", submissions: 47, validated: 44 },
  { label: "Thu", submissions: 61, validated: 57 },
  { label: "Fri", submissions: 73, validated: 67 },
  { label: "Sat", submissions: 22, validated: 21 },
  { label: "Sun", submissions: 18, validated: 17 },
]

const dataMonth = [
  { label: "W1", submissions: 240, validated: 222 },
  { label: "W2", submissions: 312, validated: 290 },
  { label: "W3", submissions: 287, validated: 264 },
  { label: "W4", submissions: 351, validated: 332 },
]

const dataYear = [
  { label: "Jan", submissions: 980, validated: 902 },
  { label: "Feb", submissions: 1124, validated: 1051 },
  { label: "Mar", submissions: 1310, validated: 1228 },
  { label: "Apr", submissions: 1462, validated: 1377 },
  { label: "May", submissions: 1318, validated: 1234 },
  { label: "Jun", submissions: 1521, validated: 1430 },
]

const ranges = [
  { id: "day", label: "Day", data: dataDay },
  { id: "month", label: "Month", data: dataMonth },
  { id: "year", label: "Year", data: dataYear },
] as const

export function ReportsChart() {
  const [range, setRange] = useState<(typeof ranges)[number]["id"]>("day")
  const data = ranges.find((r) => r.id === range)!.data
  const total = data.reduce((sum, d) => sum + d.submissions, 0)
  const validated = data.reduce((sum, d) => sum + d.validated, 0)
  const passRate = ((validated / total) * 100).toFixed(1)

  return (
    <section
      id="reports"
      aria-labelledby="reports-heading"
      className="rounded-xl border border-border bg-card shadow-card"
    >
      <header className="flex flex-col gap-3 px-5 py-4 border-b border-border md:flex-row md:items-center md:justify-between">
        <div>
          <h2 id="reports-heading" className="text-[16px] font-bold tracking-[-0.25px]">
            Submission analytics
          </h2>
          <p className="text-[12px] font-medium text-muted-foreground">
            Granular reports — sliced by day, month or year
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div role="tablist" aria-label="Time range" className="flex items-center gap-1 rounded-xl border border-border bg-background p-1">
            {ranges.map((r) => (
              <button
                key={r.id}
                role="tab"
                aria-selected={range === r.id}
                onClick={() => setRange(r.id)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-[12px] font-semibold transition-colors",
                  range === r.id
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 h-9 text-[12px] font-semibold transition-colors hover:bg-muted"
            aria-label="Export report"
          >
            <Download className="h-3.5 w-3.5" />
            Export
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border border-b border-border">
        <div className="bg-card px-5 py-3.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Total
          </div>
          <div className="mt-1 text-[20px] font-bold tracking-[-0.25px] tabular-nums">
            {total.toLocaleString()}
          </div>
        </div>
        <div className="bg-card px-5 py-3.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Validated
          </div>
          <div className="mt-1 text-[20px] font-bold tracking-[-0.25px] tabular-nums text-[#1aae39]">
            {validated.toLocaleString()}
          </div>
        </div>
        <div className="bg-card px-5 py-3.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Pass rate
          </div>
          <div className="mt-1 text-[20px] font-bold tracking-[-0.25px] tabular-nums">
            {passRate}%
          </div>
        </div>
        <div className="bg-card px-5 py-3.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground flex items-center gap-1">
            <CalendarDays className="h-3 w-3" /> Range
          </div>
          <div className="mt-1 text-[14px] font-semibold capitalize">{range}</div>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="grad-submissions" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0075de" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="#0075de" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="grad-validated" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1aae39" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="#1aae39" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(0,0,0,0.06)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "#615d59", fontSize: 11, fontWeight: 500 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fill: "#615d59", fontSize: 11, fontWeight: 500 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: "#ffffff",
                  border: "1px solid rgba(0,0,0,0.1)",
                  borderRadius: 12,
                  boxShadow:
                    "rgba(0,0,0,0.04) 0px 4px 18px, rgba(0,0,0,0.02) 0px 1px 4px",
                  fontSize: 12,
                  fontWeight: 500,
                }}
                labelStyle={{ color: "#615d59", fontWeight: 600, marginBottom: 4 }}
                cursor={{ stroke: "rgba(0,0,0,0.15)", strokeDasharray: "3 3" }}
              />
              <Area
                type="monotone"
                dataKey="submissions"
                stroke="#0075de"
                strokeWidth={2}
                fill="url(#grad-submissions)"
                name="Submissions"
              />
              <Area
                type="monotone"
                dataKey="validated"
                stroke="#1aae39"
                strokeWidth={2}
                fill="url(#grad-validated)"
                name="Validated"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-[12px] font-medium text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#0075de]" />
            Submissions received
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#1aae39]" />
            AI validated
          </span>
        </div>
      </div>
    </section>
  )
}
