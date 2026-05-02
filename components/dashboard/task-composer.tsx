"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, ListChecks, Sparkles, ShieldCheck, ChevronDown, ChevronUp, CheckSquare, Square } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { createTask } from "@/app/actions/tasks"
import type { Profile, Team, ValidationRule } from "@/lib/types"
import { cn } from "@/lib/utils"

interface TaskComposerProps {
  teams: Team[]
  defaultTeamId: string | null
  /** Members the manager can target. Provide all team members; we filter. */
  members: Profile[]
  /** All validation rules for the team to allow per-task selection. */
  rules: ValidationRule[]
}

/**
 * Manager-side form for creating and assigning a task. Supports:
 *  - choosing the target team (admins only see this picker)
 *  - bulk assigning to all members or a hand-picked subset
 *  - configuring deadline + late-submission policy
 *  - optional `instructions` that the AI pipeline evaluates per submission
 *  - selecting which validation rules apply to this specific task
 */
export function TaskComposer({ teams, defaultTeamId, members, rules }: TaskComposerProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [teamId, setTeamId] = useState<string>(defaultTeamId ?? teams[0]?.id ?? "")
  const [mode, setMode] = useState<"all" | "selected">("all")
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Validation rules selection — default: all enabled rules pre-checked
  const enabledRules = rules.filter((r) => r.enabled)
  const [selectedRuleIds, setSelectedRuleIds] = useState<Set<string>>(
    new Set(enabledRules.map((r) => r.id)),
  )
  const [rulesExpanded, setRulesExpanded] = useState(false)

  const teamMembers = members.filter((m) => m.team_id === teamId && m.role === "member")

  function toggleMember(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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

  const allRulesSelected = rules.length > 0 && selectedRuleIds.size === rules.length
  const noRulesSelected = selectedRuleIds.size === 0

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    const fd = new FormData(e.currentTarget)
    fd.set("team_id", teamId)
    fd.set("assign_mode", mode)
    if (mode === "selected") {
      fd.delete("assignee_ids")
      for (const id of selected) fd.append("assignee_ids", id)
    }
    // Signal that the rules section was visible so the server action can
    // distinguish "all rules" (section not shown) from an intentional selection.
    fd.set("rules_section_shown", "1")
    fd.delete("rule_ids")
    for (const id of selectedRuleIds) fd.append("rule_ids", id)

    startTransition(async () => {
      const res = await createTask(fd)
      if (!res.ok) {
        setError(res.error ?? "Failed to create task.")
        return
      }
      setSuccess(`Task created and assigned to ${res.assignedCount ?? 0} member(s).`)
      setSelected(new Set())
      // Reset rule selection back to all enabled rules
      setSelectedRuleIds(new Set(enabledRules.map((r) => r.id)))
      ;(e.target as HTMLFormElement).reset()
      router.refresh()
    })
  }

  return (
    <section className="rounded-xl border border-border bg-card shadow-card">
      <header className="px-4 py-3.5 lg:px-5 border-b border-border flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f2f9ff] text-[#097fe8]">
          <ListChecks className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">Create task</h2>
          <p className="text-[12px] text-muted-foreground">
            Assign a brief — AI validates each submission against your instructions.
          </p>
        </div>
      </header>

      <form onSubmit={onSubmit} className="p-4 lg:p-5 space-y-4">
        {teams.length > 1 ? (
          <div className="grid gap-1.5">
            <Label htmlFor="team">Team</Label>
            <select
              id="team"
              name="team_id_display"
              value={teamId}
              onChange={(e) => {
                setTeamId(e.target.value)
                setSelected(new Set())
              }}
              className="h-9 rounded-md border border-border bg-background px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="grid gap-1.5">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            name="title"
            required
            minLength={2}
            maxLength={200}
            placeholder="e.g. Q3 incident report"
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="description">Description (optional)</Label>
          <Textarea
            id="description"
            name="description"
            rows={2}
            maxLength={2000}
            placeholder="Short context shown to assignees on the task page."
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="instructions" className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            AI evaluation instructions (optional)
          </Label>
          <Textarea
            id="instructions"
            name="instructions"
            rows={4}
            maxLength={8000}
            placeholder={`What should the AI check? E.g. "Confirm the document includes a root-cause analysis, a timeline, and at least three preventative actions."`}
          />
          <p className="text-[11.5px] text-muted-foreground">
            Run alongside your team&apos;s standing rules whenever someone submits this task.
          </p>
        </div>

        {/* ── Validation Rules Section ─────────────────────────────────── */}
        <div className="rounded-lg border border-border overflow-hidden">
          {/* Header / toggle */}
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
                  <p className="text-[11.5px] text-muted-foreground mt-0.5">
                    Go to{" "}
                    <a href="/dashboard/rules" className="text-primary underline underline-offset-2">
                      Validation Rules
                    </a>{" "}
                    to add some.
                  </p>
                </div>
              ) : (
                <>
                  {/* Select all / clear controls */}
                  <div className="flex items-center gap-2 px-3.5 py-2 border-b border-border bg-background">
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
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {selectedRuleIds.size}/{rules.length} selected
                    </span>
                  </div>

                  {/* Rule checklist */}
                  <ul className="divide-y divide-border max-h-56 overflow-y-auto">
                    {rules.map((rule) => {
                      const checked = selectedRuleIds.has(rule.id)
                      return (
                        <li key={rule.id}>
                          <label className="flex items-start gap-3 px-3.5 py-2.5 hover:bg-muted/40 cursor-pointer transition-colors">
                            {/* Hidden form input — only submitted when checked */}
                            <span className="mt-0.5 shrink-0">
                              {checked ? (
                                <CheckSquare
                                  className="h-4 w-4 text-primary"
                                  aria-hidden="true"
                                />
                              ) : (
                                <Square
                                  className="h-4 w-4 text-muted-foreground"
                                  aria-hidden="true"
                                />
                              )}
                            </span>
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={checked}
                              onChange={() => toggleRule(rule.id)}
                            />
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
                                {rule.creator_role === "main_admin" && (
                                  <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-600 border border-blue-100">
                                    GLOBAL
                                  </span>
                                )}
                                {rule.creator_role === "manager" && (
                                  <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-600 border border-amber-100">
                                    TEAM
                                  </span>
                                )}
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
                          </label>
                        </li>
                      )
                    })}
                  </ul>

                  {noRulesSelected && (
                    <div className="px-3.5 py-2 bg-amber-50 border-t border-amber-200">
                      <p className="text-[11.5px] text-amber-700 font-medium">
                        ⚠ No standing rules selected. Only task-specific AI instructions (if any) will run for this task&apos;s submissions.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        {/* ── End Validation Rules Section ─────────────────────────────── */}

        <div className="grid gap-1.5 sm:grid-cols-2 sm:gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="due_at">Deadline (optional)</Label>
            <Input id="due_at" name="due_at" type="datetime-local" />
          </div>
          <div className="grid gap-1.5">
            <Label className="flex items-center gap-2 mt-6">
              <input
                type="checkbox"
                name="allow_late"
                defaultChecked
                className="h-4 w-4 rounded border-border accent-primary"
              />
              <span className="text-[13px]">Allow late submissions</span>
            </Label>
            <Label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="require_late_reason"
                defaultChecked
                className="h-4 w-4 rounded border-border accent-primary"
              />
              <span className="text-[13px]">Require reason if late</span>
            </Label>
          </div>
        </div>

        <fieldset className="rounded-lg border border-border p-3">
          <legend className="px-1 text-[12px] font-semibold">Assign to</legend>
          <div className="flex gap-2 mb-3">
            <button
              type="button"
              onClick={() => setMode("all")}
              className={`px-3 h-8 rounded-md text-[12.5px] font-semibold border ${
                mode === "all"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border bg-background hover:bg-muted"
              }`}
            >
              Whole team ({teamMembers.length})
            </button>
            <button
              type="button"
              onClick={() => setMode("selected")}
              className={`px-3 h-8 rounded-md text-[12.5px] font-semibold border ${
                mode === "selected"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border bg-background hover:bg-muted"
              }`}
            >
              Selected members
            </button>
          </div>
          {mode === "selected" ? (
            <ul className="grid gap-1.5 max-h-48 overflow-y-auto pr-1">
              {teamMembers.length === 0 ? (
                <li className="text-[12.5px] text-muted-foreground">
                  No members in this team yet.
                </li>
              ) : (
                teamMembers.map((m) => (
                  <li key={m.id}>
                    <label className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selected.has(m.id)}
                        onChange={() => toggleMember(m.id)}
                        className="h-4 w-4 rounded border-border accent-primary"
                      />
                      <span className="text-[13px] font-medium truncate">
                        {m.full_name ?? m.email}
                      </span>
                      <span className="ml-auto text-[11px] text-muted-foreground">{m.email}</span>
                    </label>
                  </li>
                ))
              )}
            </ul>
          ) : null}
        </fieldset>

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

        <div className="flex justify-end">
          <Button type="submit" disabled={pending || !teamId}>
            {pending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Creating…
              </>
            ) : (
              "Create & assign"
            )}
          </Button>
        </div>
      </form>
    </section>
  )
}
