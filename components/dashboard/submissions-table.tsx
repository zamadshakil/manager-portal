"use client"

import React, { useState, useTransition } from "react"
import Link from "next/link"
import { ArrowRight, FileText, Trash2, Loader2, ChevronDown, ChevronRight, ListTodo, User } from "lucide-react"
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
  grouped?: boolean
  taskMap?: Record<string, { id: string; title: string }>
  userMap?: Record<string, { id: string; full_name: string | null; email: string }>
}

interface UserGroup {
  userId: string
  userName: string
  submissions: Submission[]
}

interface TaskGroup {
  key: string
  taskId: string | null
  taskTitle: string
  userGroups: UserGroup[]
  total: number
}

function computeGroups(
  rows: Submission[],
  taskMap: Record<string, { id: string; title: string }>,
  userMap: Record<string, { id: string; full_name: string | null; email: string }>,
): TaskGroup[] {
  const byTask = new Map<string, Submission[]>()
  for (const row of rows) {
    const key = row.task_id ?? "__no_task__"
    const arr = byTask.get(key) ?? []
    arr.push(row)
    byTask.set(key, arr)
  }

  const groups: TaskGroup[] = []
  for (const [key, subs] of byTask) {
    const taskId = key === "__no_task__" ? null : key
    const taskTitle = taskId
      ? (taskMap[taskId]?.title ?? `Task ${taskId.slice(0, 8)}…`)
      : "Unassigned"

    const byUser = new Map<string, Submission[]>()
    for (const sub of subs) {
      const arr = byUser.get(sub.uploader_id) ?? []
      arr.push(sub)
      byUser.set(sub.uploader_id, arr)
    }

    const userGroups: UserGroup[] = []
    for (const [uid, userSubs] of byUser) {
      const u = userMap[uid]
      userGroups.push({
        userId: uid,
        userName: u?.full_name ?? u?.email ?? uid.slice(0, 8),
        submissions: userSubs,
      })
    }

    groups.push({ key, taskId, taskTitle, userGroups, total: subs.length })
  }

  return groups.sort((a, b) => {
    if (a.taskId === null) return 1
    if (b.taskId === null) return -1
    return a.taskTitle.localeCompare(b.taskTitle)
  })
}

export function SubmissionsTable({ rows, showFooterLink = true, emptyHint, canDelete = false, fromStatus, grouped = false, taskMap = {}, userMap = {} }: SubmissionsTableProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isDeleting, startDeleting] = useTransition()
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [targetIds, setTargetIds] = useState<string[]>([])
  const [collapsedTasks, setCollapsedTasks] = useState<Set<string>>(new Set())

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

  function toggleTask(key: string) {
    const next = new Set(collapsedTasks)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setCollapsedTasks(next)
  }

  const taskGroups = grouped && rows.length > 0 ? computeGroups(rows, taskMap, userMap) : null
  const colCount = canDelete ? 7 : 6

  return (
    <>
      <section
        aria-labelledby="submissions-heading"
        className="rounded-xl border border-border bg-card shadow-card"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3.5 lg:px-5">
          <div>
            <h2 id="submissions-heading" className="text-[15px] font-semibold tracking-tight">
              {grouped ? "Submissions by task" : "Recent submissions"}
            </h2>
            <p className="text-[12px] text-muted-foreground">
              {grouped ? "Grouped by task and contributor." : "Live LLM validation pipeline output."}
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
        ) : taskGroups ? (
          /* ── Grouped view ─────────────────────────────────────────── */
          <>
            {/* Mobile: grouped card list */}
            <div className="md:hidden divide-y divide-border">
              {taskGroups.map((tg) => {
                const isCollapsed = collapsedTasks.has(tg.key)
                return (
                  <div key={tg.key}>
                    <button
                      onClick={() => toggleTask(tg.key)}
                      className="flex w-full items-center gap-2 px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
                    >
                      {isCollapsed
                        ? <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                        : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
                      <ListTodo className="h-4 w-4 text-primary shrink-0" />
                      <span className="flex-1 text-[13px] font-semibold truncate">{tg.taskTitle}</span>
                      <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                        {tg.total}
                      </span>
                    </button>
                    {!isCollapsed && tg.userGroups.map((ug) => (
                      <div key={ug.userId}>
                        <div className="flex items-center gap-2 px-5 py-2 bg-muted/10 border-t border-border/50">
                          <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-[12px] font-semibold text-muted-foreground truncate">{ug.userName}</span>
                          <span className="ml-auto text-[11px] text-muted-foreground">{ug.submissions.length}</span>
                        </div>
                        <ul className="divide-y divide-border/40">
                          {ug.submissions.map((row) => (
                            <li key={row.id} className="px-4 py-3 pl-8">
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
                                    <Link href={detailHref(row.id)} className="block text-[13px] font-semibold truncate hover:text-primary">
                                      {row.title}
                                    </Link>
                                    {canDelete && (
                                      <button onClick={() => confirmDelete([row.id])} className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors" title="Delete submission">
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-muted-foreground">
                                    {formatBytes(row.size_bytes)} · {formatRelative(row.created_at)}
                                  </p>
                                  <div className="mt-1.5 flex items-center gap-2">
                                    <StatusBadge status={row.status} />
                                    {row.score !== null && (
                                      <span className="text-[11px] font-semibold text-muted-foreground">{Number(row.score).toFixed(0)}/100</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>

            {/* Desktop: grouped table */}
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
                    <th className="px-5 py-2.5 font-semibold"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="text-[13px]">
                  {taskGroups.map((tg) => {
                    const isCollapsed = collapsedTasks.has(tg.key)
                    return (
                      <React.Fragment key={tg.key}>
                        {/* Task header row */}
                        <tr className="border-t border-border bg-muted/30">
                          <td colSpan={colCount} className="px-4 py-2.5">
                            <button onClick={() => toggleTask(tg.key)} className="flex items-center gap-2 w-full text-left">
                              {isCollapsed
                                ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                              <ListTodo className="h-3.5 w-3.5 text-primary shrink-0" />
                              <span className="text-[13px] font-semibold">{tg.taskTitle}</span>
                              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                                {tg.total} submission{tg.total !== 1 ? "s" : ""}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                · {tg.userGroups.length} contributor{tg.userGroups.length !== 1 ? "s" : ""}
                              </span>
                            </button>
                          </td>
                        </tr>

                        {!isCollapsed && tg.userGroups.map((ug) => (
                          <React.Fragment key={`${tg.key}-${ug.userId}`}>
                            {/* User header row */}
                            <tr className="bg-muted/10 border-t border-border/40">
                              <td colSpan={colCount} className="px-7 py-1.5">
                                <div className="flex items-center gap-2">
                                  <User className="h-3 w-3 text-muted-foreground shrink-0" />
                                  <span className="text-[12px] font-semibold text-muted-foreground">{ug.userName}</span>
                                  <span className="text-[11px] text-muted-foreground/70">
                                    — {ug.submissions.length} submission{ug.submissions.length !== 1 ? "s" : ""}
                                  </span>
                                </div>
                              </td>
                            </tr>

                            {/* Submission rows */}
                            {ug.submissions.map((row) => (
                              <tr key={row.id} className="border-t border-border/30 hover:bg-muted/40 transition-colors">
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
                                  <div className="flex items-center gap-3 min-w-0 pl-6">
                                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-warm-white text-[10.5px] font-semibold tracking-wide">
                                      {fileIconLabel(row.mime_type)}
                                    </span>
                                    <Link href={detailHref(row.id)} className="block truncate font-semibold hover:text-primary">
                                      {row.title}
                                    </Link>
                                  </div>
                                </td>
                                <td className="px-5 py-3"><StatusBadge status={row.status} /></td>
                                <td className="px-5 py-3 font-mono text-[12px]">
                                  {row.score !== null ? `${Number(row.score).toFixed(0)}/100` : "—"}
                                </td>
                                <td className="px-5 py-3 text-muted-foreground">{formatBytes(row.size_bytes)}</td>
                                <td className="px-5 py-3 text-muted-foreground">{formatRelative(row.created_at)}</td>
                                <td className="px-5 py-3 text-right">
                                  <div className="flex items-center justify-end gap-3">
                                    {canDelete && (
                                      <button onClick={() => confirmDelete([row.id])} className="text-muted-foreground hover:text-destructive transition-colors p-1" title="Delete submission">
                                        <Trash2 className="h-4 w-4" />
                                      </button>
                                    )}
                                    <Link href={detailHref(row.id)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline">
                                      Open <ArrowRight className="h-3 w-3" aria-hidden="true" />
                                    </Link>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </React.Fragment>
                        ))}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          /* ── Flat view (dashboard widget) ─────────────────────────── */
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
                        <Link href={detailHref(row.id)} className="block text-[13px] font-semibold truncate hover:text-primary">
                          {row.title}
                        </Link>
                        {canDelete && (
                          <button onClick={() => confirmDelete([row.id])} className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors" title="Delete submission">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {formatBytes(row.size_bytes)} · {formatRelative(row.created_at)}
                      </p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <StatusBadge status={row.status} />
                        {row.score !== null && (
                          <span className="text-[11px] font-semibold text-muted-foreground">{Number(row.score).toFixed(0)}/100</span>
                        )}
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
                    <th className="px-5 py-2.5 font-semibold"><span className="sr-only">Actions</span></th>
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
                          <Link href={detailHref(row.id)} className="block truncate font-semibold hover:text-primary">
                            {row.title}
                          </Link>
                        </div>
                      </td>
                      <td className="px-5 py-3"><StatusBadge status={row.status} /></td>
                      <td className="px-5 py-3 font-mono text-[12px]">
                        {row.score !== null ? `${Number(row.score).toFixed(0)}/100` : "—"}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{formatBytes(row.size_bytes)}</td>
                      <td className="px-5 py-3 text-muted-foreground">{formatRelative(row.created_at)}</td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          {canDelete && (
                            <button onClick={() => confirmDelete([row.id])} className="text-muted-foreground hover:text-destructive transition-colors p-1" title="Delete submission">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                          <Link href={detailHref(row.id)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline">
                            Open <ArrowRight className="h-3 w-3" aria-hidden="true" />
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
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Deleting…
                </span>
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
