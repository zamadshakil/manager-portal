"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, ListChecks, Sparkles } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { createTask } from "@/app/actions/tasks"
import type { Profile, Team } from "@/lib/types"

interface TaskComposerProps {
  teams: Team[]
  defaultTeamId: string | null
  /** Members the manager can target. Provide all team members; we filter. */
  members: Profile[]
}

/**
 * Manager-side form for creating and assigning a task. Supports:
 *  - choosing the target team (admins only see this picker)
 *  - bulk assigning to all members or a hand-picked subset
 *  - configuring deadline + late-submission policy
 *  - optional `instructions` that the AI pipeline evaluates per submission
 */
export function TaskComposer({ teams, defaultTeamId, members }: TaskComposerProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [teamId, setTeamId] = useState<string>(defaultTeamId ?? teams[0]?.id ?? "")
  const [mode, setMode] = useState<"all" | "selected">("all")
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const teamMembers = members.filter((m) => m.team_id === teamId && m.role === "member")

  function toggleMember(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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
    startTransition(async () => {
      const res = await createTask(fd)
      if (!res.ok) {
        setError(res.error ?? "Failed to create task.")
        return
      }
      setSuccess(`Task created and assigned to ${res.assignedCount ?? 0} member(s).`)
      setSelected(new Set())
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
            placeholder="What should the AI check? E.g. &quot;Confirm the document includes a root-cause analysis, a timeline, and at least three preventative actions.&quot;"
          />
          <p className="text-[11.5px] text-muted-foreground">
            Run alongside your team's standing rules whenever someone submits this task.
          </p>
        </div>

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
