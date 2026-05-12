"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { FolderOpen, Download, Clock, Users, Trash2, Loader2, CheckSquare, Square } from "lucide-react"
import { fileIconLabel, formatBytes, formatRelative, formatDate } from "@/lib/format"
import { DeleteIconButton } from "@/components/dashboard/delete-icon-button"
import { deleteMaterial, bulkDeleteMaterials } from "@/app/actions/materials"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"
import type { Material } from "@/lib/types"

interface MaterialsProps {
  rows: Material[]
  emptyHint?: string
  canDelete?: boolean
  canDeleteGlobal?: boolean
  currentTeamId?: string | null
  showViewAll?: boolean
}

export function Materials({ rows, emptyHint, canDelete = false, canDeleteGlobal = false, currentTeamId, showViewAll = false }: MaterialsProps) {
  const router = useRouter()
  const [now, setNow] = useState(() => Date.now())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [bulkError, setBulkError] = useState<string | null>(null)
  const refreshedExpiredKeyRef = useRef<string | null>(null)

  const hasExpiringRows = useMemo(
    () => rows.some((row) => Boolean(row.expires_at)),
    [rows],
  )

  const visibleRows = useMemo(
    () => rows.filter((row) => !row.expires_at || new Date(row.expires_at).getTime() > now),
    [now, rows],
  )

  const visibleRowIds = useMemo(
    () => new Set(visibleRows.map((row) => row.id)),
    [visibleRows],
  )

  const expiredRowsKey = useMemo(
    () => rows
      .filter((row) => row.expires_at && new Date(row.expires_at).getTime() <= now)
      .map((row) => row.id)
      .join(","),
    [now, rows],
  )

  const deletableIds = visibleRows
    .filter((m) => canDelete && (canDeleteGlobal || m.team_id === currentTeamId))
    .map((m) => m.id)

  const allSelected = deletableIds.length > 0 && deletableIds.every((id) => selected.has(id))
  const someSelected = selected.size > 0

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

  useEffect(() => {
    setSelected((prev) => {
      const next = new Set(Array.from(prev).filter((id) => visibleRowIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [visibleRowIds])

  function toggleItem(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(deletableIds))
    }
  }

  function handleBulkDelete() {
    setBulkError(null)
    startTransition(async () => {
      const res = await bulkDeleteMaterials(Array.from(selected))
      if (!res.ok && res.deleted === 0) {
        setBulkError(res.errors[0] ?? "Failed to delete.")
        return
      }
      setSelected(new Set())
      setBulkConfirmOpen(false)
      router.refresh()
    })
  }

  return (
    <section
      aria-labelledby="materials-heading"
      className="rounded-xl border border-border bg-card shadow-card"
    >
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 lg:px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-warm-white shrink-0">
          <FolderOpen className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="materials-heading" className="text-[15px] font-semibold tracking-tight">
            Materials
          </h2>
          <p className="text-[12px] text-muted-foreground">
            Templates, references, and shared resources.
          </p>
        </div>
        {showViewAll ? (
          <Link
            href="/dashboard/materials"
            className="shrink-0 text-[13px] font-semibold text-primary hover:underline"
          >
            View all
          </Link>
        ) : null}
        {canDelete && deletableIds.length > 0 && rows.length > 0 && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={toggleAll}
              className="text-[11.5px] font-semibold text-primary hover:underline"
            >
              {allSelected ? "Deselect all" : "Select all"}
            </button>
            {someSelected && (
              <>
                <span className="text-muted-foreground text-[11px]">·</span>
                <button
                  type="button"
                  onClick={() => setBulkConfirmOpen(true)}
                  className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-destructive hover:underline"
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                  Delete {selected.size}
                </button>
              </>
            )}
          </div>
        )}
      </header>

      {visibleRows.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-[13px] font-semibold">No materials yet</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {emptyHint ?? "Your manager hasn't shared anything yet."}
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 p-4">
          {visibleRows.map((m) => {
            const isDeletable = canDelete && (canDeleteGlobal || m.team_id === currentTeamId)
            const isSelected = selected.has(m.id)
            return (
              <li key={m.id}>
                <div
                  className={cn(
                    "rounded-xl border border-border bg-background p-3.5 transition-shadow hover:shadow-card",
                    isSelected && "ring-2 ring-primary border-primary",
                  )}
                >
                  <div className="flex items-start gap-3">
                    {isDeletable && (
                      <button
                        type="button"
                        onClick={() => toggleItem(m.id)}
                        aria-label={isSelected ? `Deselect ${m.title}` : `Select ${m.title}`}
                        className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary transition-colors"
                      >
                        {isSelected ? (
                          <CheckSquare className="h-4 w-4 text-primary" aria-hidden="true" />
                        ) : (
                          <Square className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    )}
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warm-white text-[10.5px] font-semibold tracking-wide">
                      {fileIconLabel(m.file_type)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {m.tags.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {m.tags.slice(0, 2).map((t) => (
                              <span
                                key={t}
                                className="inline-flex items-center rounded-full bg-warm-white px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-semibold text-slate-600">
                          <Users className="h-3 w-3" />
                          {m.teams?.name ?? "Global"}
                        </span>
                      </div>
                      <h3 className="mt-1.5 text-[13.5px] font-semibold leading-snug truncate">{m.title}</h3>
                      <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                        {formatBytes(m.size_bytes)} · {formatRelative(m.created_at)}
                      </p>
                      {m.expires_at ? (
                        <div className="mt-1.5 flex items-center gap-1 text-[10.5px] font-medium text-destructive/85">
                          <Clock className="h-3 w-3" />
                          <span>Expires {formatDate(m.expires_at)}</span>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1">
                      <a
                        href={`/api/download/${m.id}?type=material`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Download ${m.title}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <Download className="h-4 w-4" aria-hidden="true" />
                      </a>
                      {isDeletable ? (
                        <DeleteIconButton
                          id={m.id}
                          action={deleteMaterial}
                          confirmText="Delete this material?"
                          label={`Delete ${m.title}`}
                        />
                      ) : null}
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <AlertDialog open={bulkConfirmOpen} onOpenChange={setBulkConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selected.size} material{selected.size === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the selected material{selected.size === 1 ? "" : "s"} and their stored files. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {bulkError ? (
            <p role="alert" className="text-[12.5px] font-semibold text-destructive">
              {bulkError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault()
                handleBulkDelete()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {pending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" aria-hidden="true" />
                  Deleting…
                </>
              ) : (
                `Delete ${selected.size}`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
