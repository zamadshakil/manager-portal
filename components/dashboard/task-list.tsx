"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CalendarClock, Users, AlertTriangle, CheckCircle2, Trash2, Loader2 } from "lucide-react"
import { formatRelative } from "@/lib/format"
import { DeleteTaskButton } from "@/components/dashboard/delete-task-button"
import { bulkDeleteTasks } from "@/app/actions/tasks"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import type { TaskWithStats } from "@/lib/data"

interface TaskListProps {
  tasks: TaskWithStats[]
  emptyHint?: string
  canDelete?: boolean
}

function dueLabel(dueAt: string | null): { label: string; tone: "default" | "warn" | "danger" } {
  if (!dueAt) return { label: "No deadline", tone: "default" }
  const ms = new Date(dueAt).getTime() - Date.now()
  if (ms < 0) return { label: `Overdue · ${formatRelative(dueAt)}`, tone: "danger" }
  const days = ms / (1000 * 60 * 60 * 24)
  if (days < 1) return { label: `Due ${formatRelative(dueAt)}`, tone: "warn" }
  return { label: `Due ${formatRelative(dueAt)}`, tone: "default" }
}

export function TaskList({ tasks, emptyHint, canDelete = false }: TaskListProps) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pending, startTransition] = useTransition()
  const [bulkError, setBulkError] = useState<string | null>(null)

  const allSelected = tasks.length > 0 && selected.size === tasks.length
  const someSelected = selected.size > 0

  function toggleOne(id: string) {
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
      setSelected(new Set(tasks.map((t) => t.id)))
    }
  }

  function handleBulkDelete() {
    setBulkError(null)
    startTransition(async () => {
      const res = await bulkDeleteTasks([...selected])
      if (!res.ok) {
        setBulkError(res.error ?? "Failed to delete tasks.")
        return
      }
      setSelected(new Set())
      router.refresh()
    })
  }

  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center shadow-card">
        <p className="text-[14px] font-semibold">No tasks yet</p>
        <p className="text-[12px] text-muted-foreground mt-1">
          {emptyHint ?? "Create your first task to assign it to your team."}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* ── Bulk action toolbar ─────────────────────────────────────── */}
      {canDelete ? (
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = someSelected && !allSelected
              }}
              onChange={toggleAll}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            <span className="text-[12.5px] font-medium text-muted-foreground">
              {someSelected ? `${selected.size} selected` : "Select all"}
            </span>
          </label>

          {someSelected ? (
            <>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="text-[12px] font-semibold text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    type="button"
                    disabled={pending}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-destructive/10 px-3 py-1.5 text-[12.5px] font-semibold text-destructive hover:bg-destructive/20 disabled:opacity-50 transition-colors"
                  >
                    {pending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    Delete {selected.size} task{selected.size === 1 ? "" : "s"}
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {selected.size} task{selected.size === 1 ? "" : "s"}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete {selected.size === 1 ? "this task" : `these ${selected.size} tasks`} and all associated assignments and data. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleBulkDelete}
                      disabled={pending}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {pending ? (
                        <span className="flex items-center gap-1.5">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Deleting…
                        </span>
                      ) : (
                        `Delete ${selected.size} task${selected.size === 1 ? "" : "s"}`
                      )}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              {bulkError ? (
                <p role="alert" className="text-[12px] font-semibold text-destructive">
                  {bulkError}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {/* ── Task cards ──────────────────────────────────────────────── */}
      <ul className="grid gap-3">
        {tasks.map((t) => {
          const due = dueLabel(t.due_at)
          const completion =
            t.total_assigned > 0 ? Math.round((t.submitted_count / t.total_assigned) * 100) : 0
          const isSelected = selected.has(t.id)

          return (
            <li
              key={t.id}
              className={`rounded-xl border bg-card shadow-card transition-colors ${
                isSelected
                  ? "border-primary/60 bg-primary/3"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <div className="flex items-stretch gap-0">
                {/* Checkbox column */}
                {canDelete ? (
                  <div
                    className="flex items-center justify-center px-3 shrink-0 cursor-pointer"
                    onClick={() => toggleOne(t.id)}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleOne(t.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 rounded border-border accent-primary"
                      aria-label={`Select task: ${t.title}`}
                    />
                  </div>
                ) : null}

                {/* Main card content (navigates) */}
                <Link href={`/dashboard/tasks/${t.id}`} className="flex-1 block p-4 lg:p-5 min-w-0">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-[15px] font-semibold tracking-tight truncate">{t.title}</h3>
                      {t.description ? (
                        <p className="mt-0.5 text-[12.5px] text-muted-foreground line-clamp-2">
                          {t.description}
                        </p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11.5px] font-medium">
                        <span
                          className={`inline-flex items-center gap-1 ${
                            due.tone === "danger"
                              ? "text-destructive"
                              : due.tone === "warn"
                                ? "text-amber-600"
                                : "text-muted-foreground"
                          }`}
                        >
                          <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                          {due.label}
                        </span>
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Users className="h-3.5 w-3.5" aria-hidden="true" />
                          {t.submitted_count}/{t.total_assigned} submitted
                        </span>
                        {t.late_count > 0 ? (
                          <span className="inline-flex items-center gap-1 text-amber-600">
                            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                            {t.late_count} late
                          </span>
                        ) : null}
                        {t.missed_count > 0 ? (
                          <span className="inline-flex items-center gap-1 text-destructive">
                            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                            {t.missed_count} missed
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="inline-flex items-center gap-1 rounded-full bg-warm-white px-2.5 py-0.5 text-[11px] font-semibold">
                        <CheckCircle2 className="h-3 w-3 text-primary" aria-hidden="true" />
                        {completion}%
                      </span>
                      {canDelete && !someSelected ? (
                        <DeleteTaskButton taskId={t.id} iconOnly />
                      ) : null}
                    </div>
                  </div>
                  {t.total_assigned > 0 ? (
                    <div className="mt-3 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${completion}%` }}
                      />
                    </div>
                  ) : null}
                </Link>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
