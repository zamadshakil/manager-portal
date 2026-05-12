"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  Loader2,
  Pencil,
  Sparkles,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  CheckSquare,
  Square,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { updateTask } from "@/app/actions/tasks"
import type { ValidationRule } from "@/lib/types"
import type { TaskWithStats } from "@/lib/data"
import { toIsoDateTimeLocal } from "@/lib/task-deadlines"
import { cn } from "@/lib/utils"

interface TaskEditorProps {
  task: TaskWithStats
  rules: ValidationRule[]
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

export function TaskEditor({ task, rules }: TaskEditorProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [isEditing, setIsEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [allowLate, setAllowLate] = useState(task.allow_late)

  const initialRuleIds =
    task.rule_ids === null
      ? new Set(rules.filter((r) => r.enabled).map((r) => r.id))
      : new Set(task.rule_ids)
  const [selectedRuleIds, setSelectedRuleIds] = useState<Set<string>>(initialRuleIds)
  const [rulesExpanded, setRulesExpanded] = useState(false)

  const allRulesSelected = rules.length > 0 && selectedRuleIds.size === rules.length
  const noRulesSelected = selectedRuleIds.size === 0

  function toggleRule(id: string) {
    setSelectedRuleIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllRules() {
    setSelectedRuleIds(new Set(rules.map((r) => r.id)))
  }

  function clearAllRules() {
    setSelectedRuleIds(new Set())
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    const fd = new FormData(e.currentTarget)
    const dueRaw = fd.get("due_at") as string
    if (dueRaw) {
      const dueIso = toIsoDateTimeLocal(dueRaw)
      if (!dueIso) {
        setError("Please choose a valid deadline date and time.")
        return
      }
      fd.set("due_at", dueIso)
    }
    const lateRaw = fd.get("late_submission_deadline") as string
    if (lateRaw) {
      const lateIso = toIsoDateTimeLocal(lateRaw)
      if (!lateIso) {
        setError("Please choose a valid late submission deadline date and time.")
        return
      }
      fd.set("late_submission_deadline", lateIso)
    }
    fd.set("rules_section_shown", "1")
    fd.delete("rule_ids")
    for (const id of selectedRuleIds) fd.append("rule_ids", id)

    startTransition(async () => {
      const res = await updateTask(fd)
      if (!res.ok) {
        setError(res.error ?? "Failed to update task.")
        return
      }
      setSuccess("Task updated successfully.")
      router.refresh()
      setIsEditing(false)
    })
  }

  if (!isEditing) {
    return (
      <button
        onClick={() => setIsEditing(true)}
        className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
      >
        <Pencil className="h-3.5 w-3.5" />
        Edit task
      </button>
    )
  }

  return (
    <section className="rounded-xl border border-border bg-card shadow-card">
      <header className="px-4 py-3.5 lg:px-5 border-b border-border flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f2f9ff] text-[#097fe8]">
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight">Edit task</h2>
          <p className="text-[12px] text-muted-foreground">
            Rule changes apply to future submissions only.
          </p>
        </div>
      </header>

      <form onSubmit={onSubmit} className="p-4 lg:p-5 space-y-4">
        <input type="hidden" name="id" value={task.id} />

        <div className="grid gap-1.5">
          <Label htmlFor="edit-title">Title</Label>
          <Input
            id="edit-title"
            name="title"
            required
            minLength={2}
            maxLength={200}
            defaultValue={task.title}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="edit-description">Description (optional)</Label>
          <Textarea
            id="edit-description"
            name="description"
            rows={2}
            maxLength={2000}
            defaultValue={task.description ?? ""}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="edit-instructions" className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            AI evaluation instructions (optional)
          </Label>
          <Textarea
            id="edit-instructions"
            name="instructions"
            rows={4}
            maxLength={8000}
            defaultValue={task.instructions ?? ""}
          />
        </div>

        {/* ── Validation Rules Section ─────────────────────────────────── */}
        <div className="rounded-lg border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => setRulesExpanded((v) => !v)}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 bg-muted/40 hover:bg-muted/70 transition-colors text-left"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#f2f9ff] text-primary shrink-0">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <div className="flex-1 min-w-0">
              <span className="text-[13px] font-semibold">Validation rules</span>
              <span className="ml-2 text-[11.5px] text-muted-foreground">
                {rules.length === 0
                  ? "No rules configured"
                  : allRulesSelected
                    ? `All ${rules.length} rule${rules.length === 1 ? "" : "s"} selected`
                    : noRulesSelected
                      ? "No rules selected — skip all standing rules"
                      : `${selectedRuleIds.size} of ${rules.length} rule${rules.length === 1 ? "" : "s"} selected`}
              </span>
            </div>
            {rulesExpanded ? (
              <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            )}
          </button>

          {rulesExpanded && (
            <div className="border-t border-border">
              {rules.length === 0 ? (
                <div className="px-4 py-5 text-center">
                  <ShieldCheck className="mx-auto h-6 w-6 text-muted-foreground mb-2" aria-hidden="true" />
                  <p className="text-[12.5px] font-semibold text-muted-foreground">
                    No validation rules configured yet.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2 px-3.5 py-2 border-b border-border bg-background">
                    <button
                      type="button"
                      onClick={selectAllRules}
                      disabled={allRulesSelected}
                      className="text-[11.5px] font-semibold text-primary hover:underline disabled:opacity-40 disabled:no-underline"
                    >
                      Select all
                    </button>
                    <span className="text-muted-foreground text-[11px]">·</span>
                    <button
                      type="button"
                      onClick={clearAllRules}
                      disabled={noRulesSelected}
                      className="text-[11.5px] font-semibold text-muted-foreground hover:text-foreground hover:underline disabled:opacity-40 disabled:no-underline"
                    >
                      Clear all
                    </button>
                    <span className="w-full text-[11px] text-muted-foreground sm:ml-auto sm:w-auto">
                      {selectedRuleIds.size}/{rules.length} selected
                    </span>
                  </div>

                  <ul className="divide-y divide-border max-h-56 overflow-y-auto overscroll-contain">
                    {rules.map((rule) => {
                      const checked = selectedRuleIds.has(rule.id)
                      return (
                        <li key={rule.id}>
                          <div
                            role="checkbox"
                            aria-checked={checked}
                            tabIndex={0}
                            onClick={() => toggleRule(rule.id)}
                            onKeyDown={(e) => {
                              if (e.key === " " || e.key === "Enter") {
                                e.preventDefault()
                                toggleRule(rule.id)
                              }
                            }}
                            className="flex items-start gap-3 px-3.5 py-2.5 hover:bg-muted/40 cursor-pointer transition-colors select-none"
                          >
                            <span className="mt-0.5 shrink-0">
                              {checked ? (
                                <CheckSquare className="h-4 w-4 text-primary" aria-hidden="true" />
                              ) : (
                                <Square className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                              )}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span
                                  className={cn(
                                    "text-[13px] font-semibold truncate",
                                    !checked && "opacity-50",
                                  )}
                                >
                                  {rule.rule_name}
                                </span>
                                {rule.creator_role === "main_admin" ? (
                                  <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-600 border border-blue-100">
                                    GLOBAL
                                  </span>
                                ) : null}
                                {rule.creator_role === "manager" ? (
                                  <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-600 border border-amber-100">
                                    TEAM
                                  </span>
                                ) : null}
                                <span
                                  className={cn(
                                    "rounded-full px-1.5 py-0.5 text-[10px] font-semibold shrink-0",
                                    rule.enabled
                                      ? "bg-[#e6f4eb] text-[#1aae39]"
                                      : "bg-muted text-muted-foreground",
                                  )}
                                >
                                  {rule.enabled ? "ENABLED" : "DISABLED"}
                                </span>
                              </div>
                              {rule.description ? (
                                <p
                                  className={cn(
                                    "text-[11.5px] text-muted-foreground mt-0.5 line-clamp-2",
                                    !checked && "opacity-50",
                                  )}
                                >
                                  {rule.description}
                                </p>
                              ) : null}
                              <p className={cn("text-[10.5px] font-mono text-muted-foreground mt-0.5", !checked && "opacity-40")}>
                                threshold {Number(rule.threshold).toFixed(1)} · weight {Number(rule.weight).toFixed(2)}
                              </p>
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>

                  {noRulesSelected ? (
                    <div className="px-3.5 py-2 bg-amber-50 border-t border-amber-200">
                      <p className="text-[11.5px] text-amber-700 font-medium">
                        ⚠ No standing rules selected. Only task-specific AI instructions (if any) will run for future submissions.
                      </p>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )}
        </div>
        {/* ── End Validation Rules Section ─────────────────────────────── */}

        <div className="grid gap-1.5 sm:grid-cols-2 sm:gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="edit-due_at">Deadline</Label>
            <Input
              id="edit-due_at"
              name="due_at"
              type="datetime-local"
              required
              defaultValue={toDatetimeLocal(task.due_at)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="flex items-center gap-2 pt-1 sm:pt-6">
              <input
                type="checkbox"
                name="allow_late"
                checked={allowLate}
                onChange={(e) => setAllowLate(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-primary"
              />
              <span className="text-[13px]">Allow late submissions</span>
            </Label>
            {allowLate && (
              <Label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="require_late_reason"
                  defaultChecked={task.require_late_reason}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                <span className="text-[13px]">Require reason if late</span>
              </Label>
            )}
          </div>
        </div>

        {allowLate && (
          <div className="grid gap-1.5 sm:grid-cols-2 sm:gap-3">
            <div className="col-start-1 grid gap-1.5">
              <Label htmlFor="edit-late_submission_deadline">Allowed up to</Label>
              <Input
                id="edit-late_submission_deadline"
                name="late_submission_deadline"
                type="datetime-local"
                required
                defaultValue={toDatetimeLocal(task.late_submission_deadline)}
              />
            </div>
          </div>
        )}

        {error ? (
          <p role="alert" className="text-[12.5px] font-semibold text-destructive">
            {error}
          </p>
        ) : null}
        {success ? (
          <p role="status" className="text-[12.5px] font-semibold text-emerald-600">
            {success}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => {
              setIsEditing(false)
              setError(null)
              setSuccess(null)
            }}
            disabled={pending}
            className="text-[12.5px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <Button type="submit" disabled={pending} className="w-full sm:w-auto">
            {pending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </div>
      </form>
    </section>
  )
}
