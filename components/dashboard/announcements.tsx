"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Megaphone, Clock, Users, Pencil, X, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatRelative, formatDate } from "@/lib/format"
import { DeleteIconButton } from "@/components/dashboard/delete-icon-button"
import { deleteAnnouncement, updateAnnouncement } from "@/app/actions/announcements"
import type { Announcement, AnnouncementPriority } from "@/lib/types"

const PRIORITIES = ["low", "normal", "high", "urgent"] as const

const priorityStyle: Record<AnnouncementPriority, string> = {
  low: "bg-muted text-muted-foreground",
  normal: "bg-[#f2f9ff] text-[#097fe8]",
  high: "bg-[#fff8e1] text-[#7a5b00]",
  urgent: "bg-[#fff1e6] text-[#a4400a]",
}

interface AnnouncementsProps {
  rows: Announcement[]
  emptyHint?: string
  canDelete?: boolean
  canDeleteGlobal?: boolean
  canEdit?: boolean
  canEditGlobal?: boolean
  currentTeamId?: string | null
  showAll?: boolean
  showViewAll?: boolean
}

export function Announcements({ rows, emptyHint, canDelete = false, canDeleteGlobal = false, canEdit = false, canEditGlobal = false, currentTeamId, showViewAll = false }: AnnouncementsProps) {
  const router = useRouter()
  const [now, setNow] = useState(() => Date.now())
  const refreshedExpiredKeyRef = useRef<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState("")
  const [editBody, setEditBody] = useState("")
  const [editPriority, setEditPriority] = useState<AnnouncementPriority>("normal")
  const [editExpiresAt, setEditExpiresAt] = useState("")
  const [editError, setEditError] = useState<string | null>(null)
  const [savePending, startSave] = useTransition()

  const hasExpiringRows = useMemo(
    () => rows.some((row) => Boolean(row.expires_at)),
    [rows],
  )

  const visibleRows = useMemo(
    () => rows.filter((row) => !row.expires_at || new Date(row.expires_at).getTime() > now),
    [now, rows],
  )

  const expiredRowsKey = useMemo(
    () => rows
      .filter((row) => row.expires_at && new Date(row.expires_at).getTime() <= now)
      .map((row) => row.id)
      .join(","),
    [now, rows],
  )

  useEffect(() => {
    if (!hasExpiringRows) return

    const interval = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)

    return () => window.clearInterval(interval)
  }, [hasExpiringRows])

  useEffect(() => {
    if (!expiredRowsKey || refreshedExpiredKeyRef.current === expiredRowsKey) return

    refreshedExpiredKeyRef.current = expiredRowsKey
    router.refresh()
  }, [expiredRowsKey, router])

  function startEdit(a: Announcement) {
    setEditingId(a.id)
    setEditTitle(a.title)
    setEditBody(a.body)
    setEditPriority(a.priority)
    setEditExpiresAt(a.expires_at ? new Date(a.expires_at).toISOString().slice(0, 16) : "")
    setEditError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditError(null)
  }

  function submitEdit(e: React.FormEvent, id: string) {
    e.preventDefault()
    setEditError(null)
    const fd = new FormData()
    fd.set("id", id)
    fd.set("title", editTitle.trim())
    fd.set("body", editBody.trim())
    fd.set("priority", editPriority)
    if (editExpiresAt) {
      const d = new Date(editExpiresAt)
      if (Number.isNaN(d.getTime())) {
        setEditError("Please choose a valid expiry date and time.")
        return
      }
      fd.set("expiresAt", d.toISOString())
    }
    startSave(async () => {
      const res = await updateAnnouncement(fd)
      if (!res.ok) {
        setEditError(res.error ?? "Failed to update.")
        return
      }
      setEditingId(null)
      router.refresh()
    })
  }

  return (
    <section
      aria-labelledby="announcements-heading"
      className="rounded-xl border border-border bg-card shadow-card"
    >
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 lg:px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-warm-white shrink-0">
          <Megaphone className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="announcements-heading" className="text-[15px] font-semibold tracking-tight">
            Announcements
          </h2>
          <p className="text-[12px] text-muted-foreground">Updates from administrators and managers.</p>
        </div>
        {showViewAll ? (
          <Link
            href="/dashboard/announcements"
            className="shrink-0 text-[13px] font-semibold text-primary hover:underline"
          >
            View all
          </Link>
        ) : null}
      </header>

      {visibleRows.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-[13px] font-semibold">No announcements yet</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {emptyHint ?? "Your administrator will post important updates here."}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {visibleRows.map((a) => (
            <li key={a.id} className="px-4 py-4 lg:px-5">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize",
                    priorityStyle[a.priority],
                  )}
                >
                  {a.priority}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                  <Users className="h-3 w-3" />
                  {a.teams?.name ?? "Global"}
                </span>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {formatRelative(a.created_at)}
                </span>
                {canEdit && (canEditGlobal || a.team_id === currentTeamId) ? (
                  editingId === a.id ? (
                    <button
                      type="button"
                      onClick={cancelEdit}
                      aria-label="Cancel edit"
                      className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEdit(a)}
                      aria-label="Edit announcement"
                      className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )
                ) : null}
                {canDelete && (canDeleteGlobal || a.team_id === currentTeamId) ? (
                  <DeleteIconButton
                    id={a.id}
                    action={deleteAnnouncement}
                    confirmText="Delete this announcement?"
                    label="Delete announcement"
                  />
                ) : null}
              </div>

              {editingId === a.id ? (
                <form onSubmit={(e) => submitEdit(e, a.id)} className="mt-3 space-y-2.5">
                  <label className="block">
                    <span className="text-[11px] font-semibold text-muted-foreground">Title</span>
                    <input
                      type="text"
                      required
                      minLength={2}
                      maxLength={200}
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-semibold text-muted-foreground">Message</span>
                    <textarea
                      required
                      minLength={2}
                      maxLength={5_000}
                      rows={4}
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-semibold text-muted-foreground">Expires At (optional)</span>
                    <input
                      type="datetime-local"
                      value={editExpiresAt}
                      onChange={(e) => setEditExpiresAt(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-1 rounded-xl border border-border bg-background p-1">
                      {PRIORITIES.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setEditPriority(p)}
                          aria-pressed={editPriority === p}
                          className={cn(
                            "rounded-lg px-2.5 py-1 text-[12px] font-semibold capitalize transition-colors",
                            editPriority === p
                              ? "bg-foreground text-background"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="rounded-xl border border-border px-3 h-8 text-[12px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={savePending}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 h-8 text-[12px] font-semibold text-primary-foreground transition-all hover:bg-[#005bab] active:scale-[0.97] disabled:opacity-60"
                      >
                        {savePending ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Saving…
                          </>
                        ) : (
                          "Save changes"
                        )}
                      </button>
                    </div>
                  </div>
                  {editError ? (
                    <p role="alert" className="text-[12px] font-semibold text-destructive">{editError}</p>
                  ) : null}
                </form>
              ) : (
                <>
                  <h3 className="mt-2 text-[14px] font-semibold leading-snug">{a.title}</h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground whitespace-pre-line">
                    {a.body}
                  </p>
                  {a.expires_at ? (
                    <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-medium text-destructive/90">
                      <Clock className="h-3.5 w-3.5" />
                      <span>Expires {formatDate(a.expires_at)}</span>
                    </div>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
