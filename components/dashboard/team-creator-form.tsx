"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { FolderPlus, Loader2 } from "lucide-react"
import { createTeam, updateTeam } from "@/app/actions/teams"
import type { Team, Profile } from "@/lib/types"

interface TeamCreatorFormProps {
  teams: Team[]
  managers: Profile[]
  editingTeam?: Team | null
  onCancelEdit?: () => void
}

export function TeamCreatorForm({ teams, managers, editingTeam, onCancelEdit }: TeamCreatorFormProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    const form = e.currentTarget
    const fd = new FormData(form)

    start(async () => {
      const action = editingTeam ? updateTeam : createTeam
      const res = await action(fd)

      if (!res.ok) {
        setError(res.error ?? "Could not save team.")
        return
      }

      const teamName = String(fd.get("name") || "")
      const actionLabel = editingTeam ? "updated" : "created"
      setSuccess(`Team "${teamName}" ${actionLabel} successfully.`)

      // For create flows, reset the form so the admin can immediately add
      // another team. For edit flows, keep the values in the inputs so the
      // user can see what they just saved alongside the success message.
      if (!editingTeam) form.reset()

      // Refresh the data on the next tick so the existing-teams list and
      // success banner stay in sync, but without the timing race that the
      // previous 500ms timeout introduced.
      router.refresh()
    })
  }

  const isEditing = !!editingTeam

  return (
    <section
      aria-labelledby="team-heading"
      className="rounded-xl border border-border bg-card shadow-card"
    >
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 lg:px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f2f9ff] text-primary">
          <FolderPlus className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 id="team-heading" className="text-[15px] font-semibold tracking-tight">
            {isEditing ? "Edit team" : "Create new team"}
          </h2>
          <p className="text-[12px] text-muted-foreground">
            {isEditing
              ? "Update team details and manager assignment."
              : "Create a new team and optionally assign a manager."}
          </p>
        </div>
      </header>

      <form onSubmit={onSubmit} className="p-4 lg:p-5 space-y-3">
        {isEditing && (
          <input type="hidden" name="team_id" value={editingTeam.id} />
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block md:col-span-2">
            <span className="text-[12px] font-semibold text-muted-foreground">Team name *</span>
            <input
              name="name"
              required
              minLength={2}
              maxLength={100}
              defaultValue={editingTeam?.name ?? ""}
              placeholder="e.g., Frontend Team, QA Team, Backend Team"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>

          <label className="block md:col-span-2">
            <span className="text-[12px] font-semibold text-muted-foreground">
              Description (optional)
            </span>
            <textarea
              name="description"
              maxLength={500}
              defaultValue={editingTeam?.description ?? ""}
              placeholder="Brief description of the team's purpose and responsibilities."
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring resize-none h-24"
            />
          </label>

          <label className="block md:col-span-2">
            <span className="text-[12px] font-semibold text-muted-foreground">
              Team manager (optional)
            </span>
            <select
              name="manager_id"
              defaultValue={editingTeam?.manager_id ?? ""}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">— No manager assigned —</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name} ({m.email})
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              The manager will be able to create tasks, assign them to team members, and manage
              validation rules for this team.
            </p>
          </label>
        </div>

        {error ? (
          <p role="alert" className="text-[12px] font-semibold text-destructive">
            {error}
          </p>
        ) : null}
        {success ? (
          <p role="status" className="text-[12px] font-semibold text-[#1aae39]">
            {success}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          {isEditing && onCancelEdit ? (
            <button
              type="button"
              onClick={onCancelEdit}
              disabled={pending}
              className="inline-flex items-center rounded-xl border border-border bg-background px-3.5 h-9 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-60"
            >
              Cancel
            </button>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 h-9 text-[13px] font-semibold text-primary-foreground transition-all hover:bg-[#005bab] active:scale-[0.97] disabled:opacity-60"
          >
            {pending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Saving…
              </>
            ) : isEditing ? (
              "Update team"
            ) : (
              "Create team"
            )}
          </button>
        </div>
      </form>
    </section>
  )
}
