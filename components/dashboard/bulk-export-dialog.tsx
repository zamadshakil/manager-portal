"use client"

import { useState } from "react"
import { Download, Loader2, Archive, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import type { UserRole } from "@/lib/types"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SUBMISSION_STATUSES = [
  { value: "passed", label: "Passed" },
  { value: "failed", label: "Failed" },
  { value: "needs_review", label: "Needs Review" },
  { value: "queued", label: "Queued" },
  { value: "validating", label: "Validating" },
  { value: "late_submitted", label: "Late" },
  { value: "missed", label: "Missed" },
]

const MIME_OPTIONS = [
  { value: "application/pdf", label: "PDF" },
  { value: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "DOCX" },
  { value: "application/vnd.openxmlformats-officedocument.presentationml.presentation", label: "PPTX" },
  { value: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", label: "XLSX" },
  { value: "image/png", label: "PNG" },
  { value: "image/jpeg", label: "JPEG" },
  { value: "text/plain", label: "TXT" },
  { value: "text/markdown", label: "MD" },
]

const QUICK_RANGES = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "This year", days: 365 },
  { label: "All time", days: null },
]

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface BulkExportDialogProps {
  type: "materials" | "submissions"
  teams: Array<{ id: string; name: string }>
  role: UserRole
  currentTeamId?: string | null
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function BulkExportDialog({
  type,
  teams,
  role,
  currentTeamId,
}: BulkExportDialogProps) {
  const today = new Date().toISOString().split("T")[0]
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0]

  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [from, setFrom] = useState(thirtyDaysAgo)
  const [to, setTo] = useState(today)
  const [team, setTeam] = useState<string>("all")
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set())
  const [selectedMimes, setSelectedMimes] = useState<Set<string>>(new Set())
  const [tagsInput, setTagsInput] = useState("")

  function setQuickRange(days: number | null) {
    setTo(today)
    if (days === null) {
      setFrom("")
    } else {
      setFrom(
        new Date(Date.now() - days * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0],
      )
    }
  }

  function toggleSet(
    set: Set<string>,
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    value: string,
  ) {
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }

  async function handleExport() {
    setError(null)
    setSuccess(null)
    setLoading(true)

    try {
      const params = new URLSearchParams({ type })
      if (from) params.set("from", from)
      if (to) params.set("to", to)

      if (role === "main_admin" && team !== "all") {
        params.set("team", team)
      }
      if (role === "manager" && currentTeamId) {
        params.set("team", currentTeamId)
      }

      if (selectedStatuses.size > 0) {
        params.set("status", [...selectedStatuses].join(","))
      }
      if (selectedMimes.size > 0) {
        params.set("mimeTypes", [...selectedMimes].join(","))
      }
      if (tagsInput.trim()) {
        params.set("tags", tagsInput.trim())
      }

      const res = await fetch(`/api/export?${params}`)

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? `Export failed (${res.status})`)
        return
      }

      const count = res.headers.get("X-Export-Count") ?? "?"
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `${type}-export-${new Date().toISOString().split("T")[0]}.zip`
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(url)

      setSuccess(`${count} file${count === "1" ? "" : "s"} exported successfully.`)
    } finally {
      setLoading(false)
    }
  }

  const isAdmin = role === "main_admin"
  const label = type === "materials" ? "Materials" : "Submissions"

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 h-10 text-[13px] font-semibold hover:bg-muted transition-colors"
        >
          <Archive className="h-4 w-4" aria-hidden="true" />
          Bulk Export
        </button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[17px] font-semibold">
            Export {label} as ZIP
          </DialogTitle>
        </DialogHeader>

        <div className="mt-3 space-y-5">
          {/* ---------------------------------------------------------------- */}
          {/* Date Range                                                       */}
          {/* ---------------------------------------------------------------- */}
          <div>
            <Label className="text-[13px] font-semibold mb-2 block">
              Date Range
            </Label>
            <div className="flex gap-2">
              <div className="flex-1">
                <p className="text-[11px] text-muted-foreground mb-1">From</p>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 h-9 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div className="flex-1">
                <p className="text-[11px] text-muted-foreground mb-1">To</p>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 h-9 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUICK_RANGES.map(({ label: rangeLabel, days }) => (
                <button
                  key={rangeLabel}
                  type="button"
                  onClick={() => setQuickRange(days)}
                  className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted/70 transition-colors"
                >
                  {rangeLabel}
                </button>
              ))}
            </div>
            {!from && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                No start date — all records included
              </p>
            )}
          </div>

          {/* ---------------------------------------------------------------- */}
          {/* Team filter (admin only)                                         */}
          {/* ---------------------------------------------------------------- */}
          {isAdmin && teams.length > 0 && (
            <div>
              <Label className="text-[13px] font-semibold mb-2 block">Team</Label>
              <Select value={team} onValueChange={setTeam}>
                <SelectTrigger className="h-9 text-[13px]">
                  <SelectValue placeholder="All teams" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All teams</SelectItem>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* ---------------------------------------------------------------- */}
          {/* File type filter                                                 */}
          {/* ---------------------------------------------------------------- */}
          <div>
            <Label className="text-[13px] font-semibold mb-2 block">
              File Types
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {MIME_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                    toggleSet(selectedMimes, setSelectedMimes, opt.value)
                  }
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${
                    selectedMimes.has(opt.value)
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/70"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {selectedMimes.size === 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                All file types included
              </p>
            )}
          </div>

          {/* ---------------------------------------------------------------- */}
          {/* Submissions: status filter                                       */}
          {/* ---------------------------------------------------------------- */}
          {type === "submissions" && (
            <div>
              <Label className="text-[13px] font-semibold mb-2 block">
                Status
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {SUBMISSION_STATUSES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() =>
                      toggleSet(selectedStatuses, setSelectedStatuses, s.value)
                    }
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${
                      selectedStatuses.has(s.value)
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/70"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              {selectedStatuses.size === 0 && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  All statuses included
                </p>
              )}
            </div>
          )}

          {/* ---------------------------------------------------------------- */}
          {/* Materials: tag filter                                            */}
          {/* ---------------------------------------------------------------- */}
          {type === "materials" && (
            <div>
              <Label className="text-[13px] font-semibold mb-2 block">
                Tags{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <input
                type="text"
                placeholder="e.g. onboarding, policy (comma-separated)"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 h-9 text-[13px] placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Leave empty to include all tags
              </p>
            </div>
          )}

          {/* ---------------------------------------------------------------- */}
          {/* ZIP structure info                                               */}
          {/* ---------------------------------------------------------------- */}
          <div className="rounded-lg bg-muted/50 border border-border px-3.5 py-3 text-[11.5px] text-muted-foreground leading-relaxed">
            <p className="font-semibold text-foreground/80 mb-1">
              ZIP folder structure
            </p>
            {type === "materials" ? (
              <code className="whitespace-pre text-[10.5px]">
                {`materials-export.zip\n├── global/\n│   └── document-a1b2c3.pdf\n└── Team-Name/\n    └── template-d4e5f6.docx`}
              </code>
            ) : (
              <code className="whitespace-pre text-[10.5px]">
                {`submissions-export.zip\n└── Team-Name/\n    └── Alice_Smith/\n        └── report-a1b2c3.pdf`}
              </code>
            )}
          </div>

          {/* ---------------------------------------------------------------- */}
          {/* Feedback                                                         */}
          {/* ---------------------------------------------------------------- */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive font-medium">
              <X className="h-4 w-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}
          {success && (
            <div className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 px-3 py-2.5 text-[13px] text-green-700 dark:text-green-400 font-medium">
              {success}
            </div>
          )}

          {/* ---------------------------------------------------------------- */}
          {/* Actions                                                          */}
          {/* ---------------------------------------------------------------- */}
          <div className="flex items-center justify-end gap-2 pt-1 border-t border-border">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-xl border border-border px-4 h-10 text-[13px] font-semibold hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 h-10 text-[13px] font-semibold text-primary-foreground hover:bg-[#005bab] active:scale-[0.97] disabled:opacity-60 disabled:cursor-not-allowed transition-all"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Exporting…
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Export ZIP
                </>
              )}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
