"use client"

import { useState } from "react"
import {
  FileText,
  Image as ImageIcon,
  Presentation,
  FileType2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  MoreHorizontal,
  Filter,
  ArrowUpDown,
} from "lucide-react"
import { cn } from "@/lib/utils"

type FileKind = "pdf" | "doc" | "ppt" | "image"

type Status = "passed" | "review" | "failed" | "processing"

type Submission = {
  id: string
  title: string
  kind: FileKind
  size: string
  member: { name: string; team: string }
  status: Status
  score: number
  summary: string
  submittedAt: string
}

const submissions: Submission[] = [
  {
    id: "S-2491",
    title: "Q2 Compliance Report — North District",
    kind: "pdf",
    size: "4.2 MB",
    member: { name: "Maya Chen", team: "Compliance" },
    status: "passed",
    score: 96,
    summary:
      "All 14 policy checks passed. Document follows ISO 27001 structure with clear evidence of control attestation.",
    submittedAt: "08:42",
  },
  {
    id: "S-2490",
    title: "Field Inspection — Site 14B Photographs",
    kind: "image",
    size: "12.1 MB",
    member: { name: "Daniel Reyes", team: "Field Ops" },
    status: "review",
    score: 78,
    summary:
      "Image OCR extracted 11 of 12 required tags. Equipment serial number partially obscured — manager review recommended.",
    submittedAt: "08:31",
  },
  {
    id: "S-2489",
    title: "Onboarding Deck — New Hires Cohort 12",
    kind: "ppt",
    size: "8.7 MB",
    member: { name: "Priya Shah", team: "People Ops" },
    status: "passed",
    score: 91,
    summary:
      "Slide structure matches template. AI suggests adding two more diversity policy slides before publishing.",
    submittedAt: "Yesterday",
  },
  {
    id: "S-2488",
    title: "Vendor Risk Assessment v3",
    kind: "doc",
    size: "2.4 MB",
    member: { name: "Jordan Wells", team: "Procurement" },
    status: "failed",
    score: 42,
    summary:
      "Missing required sections: financial liability clause and SLA matrix. Returned to author with annotated feedback.",
    submittedAt: "Yesterday",
  },
  {
    id: "S-2487",
    title: "Customer Success QBR — Enterprise",
    kind: "pdf",
    size: "5.6 MB",
    member: { name: "Lina Osei", team: "CS" },
    status: "processing",
    score: 0,
    summary: "Parsing 32 pages and 14 charts. Validation in progress.",
    submittedAt: "08:55",
  },
  {
    id: "S-2486",
    title: "Incident Postmortem — Outage 04/24",
    kind: "doc",
    size: "1.1 MB",
    member: { name: "Ravi Kapoor", team: "Engineering" },
    status: "passed",
    score: 88,
    summary: "Includes timeline, root cause, action items. Two follow-up tickets auto-created.",
    submittedAt: "Yesterday",
  },
]

const fileIcon: Record<FileKind, React.ComponentType<{ className?: string }>> = {
  pdf: FileType2,
  doc: FileText,
  ppt: Presentation,
  image: ImageIcon,
}

const fileColor: Record<FileKind, string> = {
  pdf: "bg-[#fdecdc] text-[#dd5b00]",
  doc: "bg-[#f2f9ff] text-[#097fe8]",
  ppt: "bg-[#fce8f4] text-[#c11574]",
  image: "bg-[#eafbef] text-[#1aae39]",
}

const statusConfig: Record<
  Status,
  { label: string; icon: React.ComponentType<{ className?: string }>; cls: string }
> = {
  passed: { label: "Validated", icon: CheckCircle2, cls: "bg-[#eafbef] text-[#1aae39]" },
  review: { label: "Needs review", icon: AlertTriangle, cls: "bg-[#fef8e1] text-[#a86b00]" },
  failed: { label: "Rejected", icon: XCircle, cls: "bg-[#fdecdc] text-[#dd5b00]" },
  processing: { label: "Processing", icon: Loader2, cls: "bg-[#f2f9ff] text-[#097fe8]" },
}

const filters = ["All", "Validated", "Needs review", "Rejected", "Processing"] as const

export function SubmissionsTable() {
  const [activeFilter, setActiveFilter] = useState<(typeof filters)[number]>("All")

  const filtered = submissions.filter((s) => {
    if (activeFilter === "All") return true
    return statusConfig[s.status].label === activeFilter
  })

  return (
    <section
      id="submissions"
      aria-labelledby="submissions-heading"
      className="rounded-xl border border-border bg-card shadow-card"
    >
      <header className="flex flex-col gap-3 px-5 py-4 border-b border-border md:flex-row md:items-center md:justify-between">
        <div>
          <h2
            id="submissions-heading"
            className="text-[16px] font-bold tracking-[-0.25px]"
          >
            Submission pipeline
          </h2>
          <p className="text-[12px] font-medium text-muted-foreground">
            Live view of uploads validated by the LLM analysis pipeline
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div role="tablist" aria-label="Filter by status" className="hidden md:flex items-center gap-1 rounded-xl border border-border bg-background p-1">
            {filters.map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={activeFilter === f}
                onClick={() => setActiveFilter(f)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-[12px] font-semibold transition-colors",
                  activeFilter === f
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="md:hidden inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 h-9 text-[13px] font-semibold"
            aria-label="Filter submissions"
          >
            <Filter className="h-3.5 w-3.5" /> Filter
          </button>
        </div>
      </header>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto scrollbar-thin">
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr className="bg-warm-white text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              <th scope="col" className="px-5 py-3 font-semibold">
                <button className="inline-flex items-center gap-1 hover:text-foreground">
                  Submission <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
              <th scope="col" className="px-5 py-3 font-semibold">Member</th>
              <th scope="col" className="px-5 py-3 font-semibold">AI Status</th>
              <th scope="col" className="px-5 py-3 font-semibold">Score</th>
              <th scope="col" className="px-5 py-3 font-semibold">Submitted</th>
              <th scope="col" className="px-5 py-3 font-semibold w-10">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((s) => {
              const Icon = fileIcon[s.kind]
              const StatusIcon = statusConfig[s.status].icon
              return (
                <tr key={s.id} className="transition-colors hover:bg-muted/40 align-middle">
                  <td className="px-5 py-3.5">
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                          fileColor[s.kind],
                        )}
                      >
                        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold tracking-[-0.125px] truncate max-w-[320px]">
                          {s.title}
                        </div>
                        <div className="text-[12px] font-medium text-muted-foreground">
                          {s.id} · {s.kind.toUpperCase()} · {s.size}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="font-semibold">{s.member.name}</div>
                    <div className="text-[12px] font-medium text-muted-foreground">
                      {s.member.team}
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-[0.125px]",
                        statusConfig[s.status].cls,
                      )}
                    >
                      <StatusIcon
                        className={cn("h-3 w-3", s.status === "processing" && "animate-spin")}
                        aria-hidden="true"
                      />
                      {statusConfig[s.status].label}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    {s.status === "processing" ? (
                      <span className="text-[12px] font-medium text-muted-foreground">—</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn(
                              "h-full rounded-full",
                              s.score >= 80
                                ? "bg-[#1aae39]"
                                : s.score >= 60
                                ? "bg-[#dd9b00]"
                                : "bg-[#dd5b00]",
                            )}
                            style={{ width: `${s.score}%` }}
                          />
                        </div>
                        <span className="text-[12px] font-semibold tabular-nums">{s.score}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-[12px] font-medium text-muted-foreground tabular-nums">
                    {s.submittedAt}
                  </td>
                  <td className="px-5 py-3.5">
                    <button
                      type="button"
                      aria-label={`Actions for ${s.title}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile list */}
      <ul className="md:hidden divide-y divide-border">
        {filtered.map((s) => {
          const Icon = fileIcon[s.kind]
          const StatusIcon = statusConfig[s.status].icon
          return (
            <li key={s.id} className="px-4 py-4">
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                    fileColor[s.kind],
                  )}
                >
                  <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold tracking-[-0.125px]">{s.title}</div>
                  <div className="text-[12px] font-medium text-muted-foreground">
                    {s.member.name} · {s.member.team}
                  </div>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-[0.125px]",
                        statusConfig[s.status].cls,
                      )}
                    >
                      <StatusIcon
                        className={cn("h-3 w-3", s.status === "processing" && "animate-spin")}
                      />
                      {statusConfig[s.status].label}
                    </span>
                    {s.status !== "processing" && (
                      <span className="text-[11px] font-semibold text-muted-foreground tabular-nums">
                        Score {s.score}
                      </span>
                    )}
                    <span className="ml-auto text-[11px] font-medium text-muted-foreground">
                      {s.submittedAt}
                    </span>
                  </div>
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      <footer className="flex items-center justify-between border-t border-border px-5 py-3 text-[12px] font-medium text-muted-foreground">
        <span>
          Showing <span className="font-semibold text-foreground">{filtered.length}</span> of{" "}
          {submissions.length} submissions
        </span>
        <a
          href="#all-submissions"
          className="font-semibold text-primary hover:underline"
        >
          Open full pipeline →
        </a>
      </footer>
    </section>
  )
}
