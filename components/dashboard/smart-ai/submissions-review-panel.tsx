"use client"

import { useMemo, useState, useEffect } from "react"
import Link from "next/link"
import {
  FileText,
  ImageIcon,
  Search,
  Sparkles,
  Filter,
  ExternalLink,
  X,
  Download,
  Loader2,
} from "lucide-react"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { fileIconLabel, formatBytes, formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Submission, SubmissionStatus } from "@/lib/types"

interface SubmissionsReviewPanelProps {
  submissions: Submission[]
  onAskAi: (s: Submission) => void
}

type StatusFilter = "all" | SubmissionStatus

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "passed", label: "Passed" },
  { id: "failed", label: "Failed" },
  { id: "needs_review", label: "Needs review" },
  { id: "late_submitted", label: "Late" },
]

export function SubmissionsReviewPanel({
  submissions,
  onAskAi,
}: SubmissionsReviewPanelProps) {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<StatusFilter>("all")
  const [activeId, setActiveId] = useState<string | null>(submissions[0]?.id ?? null)

  const filtered = useMemo(() => {
    return submissions.filter((s) => {
      if (status !== "all" && s.status !== status) return false
      if (query.trim()) {
        const needle = query.trim().toLowerCase()
        if (!s.title.toLowerCase().includes(needle)) return false
      }
      return true
    })
  }, [submissions, status, query])

  const active = filtered.find((s) => s.id === activeId) ?? filtered[0] ?? null

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 lg:gap-6 min-w-0">
      {/* List column */}
      <section
        aria-label="Submissions list"
        className="lg:col-span-2 rounded-xl border border-border bg-card shadow-card overflow-hidden flex flex-col min-h-[560px] max-h-[80vh]"
      >
        <header className="border-b border-border px-4 py-3.5 lg:px-5 space-y-2.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-warm-white">
              <FileText className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold tracking-tight">Submissions</h2>
              <p className="text-[12px] text-muted-foreground">
                {filtered.length} of {submissions.length} shown
              </p>
            </div>
          </div>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title…"
              className="w-full rounded-lg border border-border bg-background pl-8 pr-3 py-1.5 text-[13px] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring transition-all"
              aria-label="Filter submissions by title"
            />
          </div>
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin">
            <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatus(f.id)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap transition-colors",
                  status === f.id
                    ? "bg-[#f2f9ff] text-[#097fe8]"
                    : "bg-warm-white text-muted-foreground hover:bg-muted",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </header>
        {filtered.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-10">
            <FileText className="h-8 w-8 text-muted-foreground/40 mb-3" aria-hidden="true" />
            <p className="text-[13px] font-semibold">No submissions match</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Try clearing filters or upload a new document.
            </p>
          </div>
        ) : (
          <ul className="flex-1 overflow-y-auto scrollbar-thin divide-y divide-border">
            {filtered.map((s) => {
              const isActive = active?.id === s.id
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(s.id)}
                    className={cn(
                      "w-full text-left flex items-start gap-3 px-4 py-3 transition-colors",
                      isActive ? "bg-[#f2f9ff]" : "hover:bg-muted/40",
                    )}
                    aria-current={isActive ? "true" : undefined}
                  >
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warm-white text-[10.5px] font-semibold tracking-wide">
                      {fileIconLabel(s.mime_type)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold truncate">{s.title}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {formatBytes(s.size_bytes)} · {formatRelative(s.created_at)}
                      </p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <StatusBadge status={s.status} />
                        {s.score !== null ? (
                          <span className="text-[11px] font-semibold text-muted-foreground">
                            {Number(s.score).toFixed(0)}/100
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Preview column */}
      <section
        aria-label="Submission preview"
        className="lg:col-span-3 rounded-xl border border-border bg-card shadow-card overflow-hidden flex flex-col min-h-[560px]"
      >
        {active ? (
          <PreviewPane submission={active} onAskAi={() => onAskAi(active)} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12">
            <FileText className="h-10 w-10 text-muted-foreground/30 mb-3" aria-hidden="true" />
            <p className="text-[14px] font-semibold">Select a submission</p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Pick something on the left to preview the file and ask AI for a grounded summary.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}

function PreviewPane({
  submission,
  onAskAi,
}: {
  submission: Submission
  onAskAi: () => void
}) {
  const isImage = submission.mime_type.startsWith("image/")
  const isPdf = submission.mime_type.includes("pdf")
  const isText = submission.mime_type.startsWith("text/")
  const isOffice =
    submission.mime_type.includes("word") ||
    submission.mime_type.includes("officedocument") ||
    submission.mime_type.includes("excel") ||
    submission.mime_type.includes("spreadsheet") ||
    submission.mime_type.includes("powerpoint") ||
    submission.mime_type.includes("presentation")

  const [textContent, setTextContent] = useState<string | null>(null)
  const [isTextLoading, setIsTextLoading] = useState(false)

  useEffect(() => {
    if (isText) {
      setTextContent(null)
      setIsTextLoading(true)
      // Fetch text content via the proxy to ensure auth and correct headers
      fetch(`/api/download/${submission.id}?type=submission`)
        .then((res) => {
          if (!res.ok) throw new Error("Failed to fetch")
          return res.text()
        })
        .then((text) => {
          setTextContent(text)
          setIsTextLoading(false)
        })
        .catch((err) => {
          console.error("[preview] text fetch failed", err)
          setTextContent("Error loading text content.")
          setIsTextLoading(false)
        })
    }
  }, [isText, submission.id])

  return (
    <>
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3.5 lg:px-5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight truncate">
            {submission.title}
          </h2>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <StatusBadge status={submission.status} />
            {submission.score !== null ? (
              <span className="inline-flex items-center rounded-full bg-warm-white px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                Score {Number(submission.score).toFixed(0)}/100
              </span>
            ) : null}
            <span className="text-[11.5px] text-muted-foreground">
              {formatBytes(submission.size_bytes)} · {formatRelative(submission.created_at)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onAskAi}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground hover:bg-[#005bab] active:scale-[0.97] transition-all"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Ask AI
          </button>
          <Link
            href={`/dashboard/submissions/${submission.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-[12px] font-semibold text-foreground hover:bg-muted transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            Open
          </Link>
        </div>
      </header>

      {/* Preview body */}
      <div className="flex-1 bg-warm-white border-b border-border overflow-hidden">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={submission.blob_url}
            alt={submission.title}
            className="max-h-[60vh] w-full object-contain bg-warm-white"
          />
        ) : isPdf ? (
          <iframe
            src={submission.blob_url}
            title={submission.title}
            className="w-full h-[60vh] bg-warm-white"
          />
        ) : isText ? (
          <div className="h-[60vh] w-full overflow-auto p-4 bg-background">
            {isTextLoading ? (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                <span className="text-[13px]">Loading text content…</span>
              </div>
            ) : (
              <pre className="text-[12.5px] leading-relaxed font-mono whitespace-pre-wrap text-foreground">
                {textContent}
              </pre>
            )}
          </div>
        ) : isOffice ? (
          <div className="flex flex-col items-center justify-center h-[60vh] text-center px-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-warm-white text-primary mb-4">
              <FileText className="h-6 w-6" aria-hidden="true" />
            </div>
            <p className="text-[14px] font-semibold text-foreground">
              Inline preview not available for Word/Office documents
            </p>
            <p className="mt-1 text-[12.5px] text-muted-foreground max-w-sm">
              {fileIconLabel(submission.mime_type)} files are best viewed in their native applications.
            </p>
            <a
              href={`/api/download/${submission.id}?type=submission`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground hover:bg-[#005bab] transition-all"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Download to View
            </a>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-[60vh] text-center px-6">
            <ImageIcon className="h-10 w-10 text-muted-foreground/30 mb-3" aria-hidden="true" />
            <p className="text-[13.5px] font-semibold">Inline preview not available</p>
            <p className="mt-1 text-[12px] text-muted-foreground max-w-sm">
              {fileIconLabel(submission.mime_type)} files open in their dedicated viewer. Use
              &quot;Open&quot; to launch the full submission detail page.
            </p>
          </div>
        )}
      </div>

      {/* Validation summary */}
      <div className="px-4 py-3.5 lg:px-5 lg:py-4">
        {submission.summary ? (
          <p className="text-[13px] leading-relaxed text-foreground/80 whitespace-pre-line line-clamp-4">
            {submission.summary}
          </p>
        ) : (
          <p className="text-[12.5px] text-muted-foreground">
            No AI summary yet. Click &quot;Ask AI&quot; to generate one grounded in this
            submission&apos;s extracted text.
          </p>
        )}

        {submission.flags.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {submission.flags.slice(0, 6).map((f, i) => (
              <li
                key={`${f.rule_id ?? "rule"}-${i}`}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
                  f.severity === "fail"
                    ? "bg-[#fff1e6] text-[#a4400a]"
                    : f.severity === "warn"
                      ? "bg-[#fff8e1] text-[#7a5b00]"
                      : "bg-[#f2f9ff] text-[#097fe8]",
                )}
              >
                {f.severity === "fail" ? (
                  <X className="h-2.5 w-2.5" aria-hidden="true" />
                ) : null}
                {f.rule_name ?? "Rule"}: {f.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </>
  )
}
