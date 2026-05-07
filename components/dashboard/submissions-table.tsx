"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { ArrowRight, FileText, Trash2, Loader2 } from "lucide-react"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { fileIconLabel, formatBytes, formatRelative } from "@/lib/format"
import { Checkbox } from "@/components/ui/checkbox"
import { bulkDeleteSubmissions } from "@/app/actions/submissions"
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
import type { Submission } from "@/lib/types"

interface SubmissionsTableProps {
  rows: Submission[]
  showFooterLink?: boolean
  emptyHint?: string
  canDelete?: boolean
  fromStatus?: string
}

export function SubmissionsTable({ rows, showFooterLink = true, emptyHint, canDelete = false, fromStatus }: SubmissionsTableProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isDeleting, startDeleting] = useTransition()
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [targetIds, setTargetIds] = useState<string[]>([])

  function detailHref(id: string) {
    const qs = fromStatus ? `?fromStatus=${encodeURIComponent(fromStatus)}` : ""
    return `/dashboard/submissions/${id}${qs}`
  }

  const allSelected = rows.length > 0 && selectedIds.size === rows.length
  const someSelected = selectedIds.size > 0 && selectedIds.size < rows.length

  function handleSelectAll(checked: boolean) {
    if (checked) {
      setSelectedIds(new Set(rows.map((r) => r.id)))
    } else {
      setSelectedIds(new Set())
    }
  }

  function handleSelectRow(id: string, checked: boolean) {
    const next = new Set(selectedIds)
    if (checked) next.add(id)
    else next.delete(id)
    setSelectedIds(next)
  }

  function confirmDelete(ids: string[]) {
    setTargetIds(ids)
    setDeleteModalOpen(true)
  }

  function handleDelete() {
    startDeleting(async () => {
      const formData = new FormData()
      formData.append("ids_json", JSON.stringify(targetIds))
      const res = await bulkDeleteSubmissions(formData)
      if (res.ok) {
        setDeleteModalOpen(false)
        setSelectedIds(new Set())
      } else {
        alert(res.error || "Failed to delete submissions.")
        setDeleteModalOpen(false)
      }
    })
  }

  return (
    <>
      <section
        aria-labelledby="submissions-heading"
        className="rounded-xl border border-border bg-card shadow-card"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3.5 lg:px-5">
          <div>
            <h2 id="submissions-heading" className="text-[15px] font-semibold tracking-tight">
              Recent submissions
            </h2>
            <p className="text-[12px] text-muted-foreground">
              Live LLM validation pipeline output.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {canDelete && selectedIds.size > 0 && (
              <button
                onClick={() => confirmDelete(Array.from(selectedIds))}
                className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-destructive hover:text-destructive/80 transition-colors"
              >
                <Trash2 className="h-4 w-4" />
                Delete ({selectedIds.size})
              </button>
            )}
            {showFooterLink ? (
              <Link
                href="/dashboard/submissions"
                className="text-[13px] font-semibold text-primary hover:underline"
              >
                View all
              </Link>
            ) : null}
          </div>
        </header>

        {rows.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <FileText className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="mt-3 text-[14px] font-semibold">No submissions yet</p>
            <p className="text-[12px] text-muted-foreground mt-1">
              {emptyHint ?? "Upload a document to begin AI validation."}
            </p>
          </div>
        ) : (
          <>
            {/* Mobile: card list */}
            <ul className="md:hidden divide-y divide-border">
              {rows.map((row) => (
                <li key={row.id} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    {canDelete && (
                      <div className="pt-1 shrink-0">
                        <Checkbox
                          checked={selectedIds.has(row.id)}
                          onCheckedChange={(checked) => handleSelectRow(row.id, !!checked)}
                          aria-label={`Select ${row.title}`}
                        />
                      </div>
                    )}
                    <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warm-white text-[10.5px] font-semibold tracking-wide">
                      {fileIconLabel(row.mime_type)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          href={detailHref(row.id)}
                          className="block text-[13px] font-semibold truncate hover:text-primary"
                        >
                          {row.title}
                        </Link>
                        {canDelete && (
                          <button
                            onClick={() => confirmDelete([row.id])}
                            className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors"
                            title="Delete submission"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {formatBytes(row.size_bytes)} · {formatRelative(row.created_at)}
                      </p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <StatusBadge status={row.status} />
                        {row.score !== null ? (
                          <span className="text-[11px] font-semibold text-muted-foreground">
                            {Number(row.score).toFixed(0)}/100
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {/* Desktop: table */}
            <div className="hidden md:block">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-[0.04em] text-muted-foreground">
                    {canDelete && (
                      <th className="px-5 py-2.5 w-10">
                        <Checkbox
                          checked={allSelected ? true : someSelected ? "indeterminate" : false}
                          onCheckedChange={(c) => handleSelectAll(!!c)}
                          aria-label="Select all submissions"
                        />
                      </th>
                    )}
                    <th className="px-2 py-2.5 font-semibold w-full">Submission</th>
                    <th className="px-5 py-2.5 font-semibold whitespace-nowrap">Status</th>
                    <th className="px-5 py-2.5 font-semibold whitespace-nowrap">Score</th>
                    <th className="px-5 py-2.5 font-semibold whitespace-nowrap">Size</th>
                    <th className="px-5 py-2.5 font-semibold whitespace-nowrap">Uploaded</th>
                    <th className="px-5 py-2.5 font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-[13px]">
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-muted/40 transition-colors">
                      {canDelete && (
                        <td className="px-5 py-3">
                          <Checkbox
                            checked={selectedIds.has(row.id)}
                            onCheckedChange={(checked) => handleSelectRow(row.id, !!checked)}
                            aria-label={`Select ${row.title}`}
                          />
                        </td>
                      )}
                      <td className="px-2 py-3 max-w-[0px] w-full">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-warm-white text-[10.5px] font-semibold tracking-wide">
                            {fileIconLabel(row.mime_type)}
                          </span>
                          <Link
                            href={detailHref(row.id)}
                            className="block truncate font-semibold hover:text-primary"
                          >
                            {row.title}
                          </Link>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="px-5 py-3 font-mono text-[12px]">
                        {row.score !== null ? `${Number(row.score).toFixed(0)}/100` : "—"}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {formatBytes(row.size_bytes)}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {formatRelative(row.created_at)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          {canDelete && (
                            <button
                              onClick={() => confirmDelete([row.id])}
                              className="text-muted-foreground hover:text-destructive transition-colors p-1"
                              title="Delete submission"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                          <Link
                            href={detailHref(row.id)}
                            className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline"
                          >
                            Open
                            <ArrowRight className="h-3 w-3" aria-hidden="true" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <AlertDialog open={deleteModalOpen} onOpenChange={setDeleteModalOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. You are about to permanently delete{" "}
              <strong className="text-foreground">{targetIds.length}</strong>{" "}
              submission{targetIds.length === 1 ? "" : "s"}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleDelete()
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Deleting...</span>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
