"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ShieldCheck, Trash2, Edit3, Loader2, Plus } from "lucide-react"
import { upsertRule, deleteRule } from "@/app/actions/rules"
import type { ValidationRule, Profile, Team } from "@/lib/types"
import { cn } from "@/lib/utils"
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

interface Props {
  rules: ValidationRule[]
  teams?: Team[]
  profile?: Profile
  canCreate?: boolean
  canUpdate?: boolean
  canDelete?: boolean
}

export function RulesEditor({ rules, teams, profile, canCreate = false, canUpdate = false, canDelete = false }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState<ValidationRule | null>(null)
  const [creating, setCreating] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setEditing(null)
    setCreating(false)
    setError(null)
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    if (editing) fd.set("id", editing.id)
    start(async () => {
      const res = await upsertRule(fd)
      if (!res.ok) {
        setError(res.error ?? "Could not save.")
        return
      }
      reset()
      router.refresh()
    })
  }

  function onDelete(id: string) {
    const fd = new FormData()
    fd.set("id", id)
    start(async () => {
      const res = await deleteRule(fd)
      if (!res.ok) setError(res.error ?? "Could not delete.")
      router.refresh()
    })
  }

  return (
    <section
      aria-labelledby="rules-heading"
      className="rounded-xl border border-border bg-card shadow-card"
    >
      <header className="flex flex-wrap items-center gap-2.5 border-b border-border px-4 py-3.5 lg:px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f2f9ff] text-primary">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="mr-auto">
          <h2 id="rules-heading" className="text-[15px] font-semibold tracking-tight">
            Validation rules
          </h2>
          <p className="text-[12px] text-muted-foreground">
            Each enabled rule is run by the LLM against every new submission.
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => {
              setEditing(null)
              setCreating(true)
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 h-9 text-[12px] font-semibold transition-colors hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> New rule
          </button>
        )}
      </header>

      {creating || editing ? (
        <form onSubmit={onSubmit} className="border-b border-border bg-warm-white p-4 lg:p-5 space-y-3">

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-[12px] font-semibold text-muted-foreground">Rule name</span>
              <input
                name="rule_name"
                required
                minLength={2}
                maxLength={200}
                defaultValue={editing?.rule_name ?? ""}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <label className="block">
              <span className="text-[12px] font-semibold text-muted-foreground">Threshold (0-100)</span>
              <input
                name="threshold"
                type="number"
                min={0}
                max={100}
                step="0.5"
                required
                defaultValue={editing?.threshold ?? 70}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <label className="block">
              <span className="text-[12px] font-semibold text-muted-foreground">Weight (0-10)</span>
              <input
                name="weight"
                type="number"
                min={0}
                max={10}
                step="0.25"
                required
                defaultValue={editing?.weight ?? 1}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <label className="flex items-center gap-2 mt-6">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={editing ? editing.enabled : true}
                className="rounded border-border"
              />
              <span className="text-[12px] font-semibold">Enabled</span>
            </label>
          </div>
          <label className="block">
            <span className="text-[12px] font-semibold text-muted-foreground">Description</span>
            <input
              name="description"
              maxLength={1_000}
              defaultValue={editing?.description ?? ""}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="block">
            <span className="text-[12px] font-semibold text-muted-foreground">
              Prompt template
            </span>
            <textarea
              name="prompt_template"
              required
              minLength={20}
              maxLength={4_000}
              rows={5}
              defaultValue={editing?.prompt_template ?? ""}
              placeholder="Inspect the document for X. Score from 0-100 and list specific issues."
              className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          {error ? (
            <p role="alert" className="text-[12px] font-semibold text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={reset}
              className="rounded-xl border border-border bg-background px-3 h-9 text-[12px] font-semibold transition-colors hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 h-9 text-[13px] font-semibold text-primary-foreground transition-all hover:bg-[#005bab] active:scale-[0.97] disabled:opacity-60"
            >
              {pending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Saving…
                </>
              ) : editing ? (
                "Update rule"
              ) : (
                "Create rule"
              )}
            </button>
          </div>
        </form>
      ) : null}

      {rules.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 text-[14px] font-semibold">No rules configured</p>
          <p className="text-[12px] text-muted-foreground mt-1">
            Add a rule to start automated validation.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rules.map((rule) => (
            <li key={rule.id} className="px-4 py-3.5 lg:px-5 flex flex-wrap items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[13.5px] font-semibold truncate">{rule.rule_name}</p>
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                      rule.enabled
                        ? "bg-[#e6f4eb] text-[#1aae39]"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {rule.enabled ? "ENABLED" : "DISABLED"}
                  </span>
                </div>
                {rule.description ? (
                  <p className="mt-0.5 text-[12px] text-muted-foreground line-clamp-2">
                    {rule.description}
                  </p>
                ) : null}
                <p className="mt-1 text-[11px] font-mono text-muted-foreground">
                  threshold {Number(rule.threshold).toFixed(1)} · weight{" "}
                  {Number(rule.weight).toFixed(2)}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {rule.creator_role === "main_admin" && (
                  <span className="mr-1 rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-600 border border-blue-100">
                    GLOBAL
                  </span>
                )}
                {rule.creator_role === "manager" && (
                  <span className="mr-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-600 border border-amber-100">
                    TEAM
                  </span>
                )}
                {/* Product guard: managers cannot touch admin-authored rules */}
                {canUpdate && !(profile?.role === "manager" && rule.creator_role === "main_admin") && (
                  <button
                    type="button"
                    onClick={() => {
                      setCreating(false)
                      setEditing(rule)
                    }}
                    aria-label="Edit rule"
                    className="rounded-lg border border-border bg-background h-8 w-8 inline-flex items-center justify-center hover:bg-muted transition-colors"
                  >
                    <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
                {canDelete && !(profile?.role === "manager" && rule.creator_role === "main_admin") && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button
                        type="button"
                        aria-label={`Delete rule ${rule.rule_name}`}
                        className="rounded-lg border border-border bg-background h-8 w-8 inline-flex items-center justify-center hover:bg-muted text-destructive transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this rule?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Future submissions will skip <strong>{rule.rule_name}</strong>. Existing
                          validation runs are unaffected.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => onDelete(rule.id)}
                          className="bg-destructive text-white hover:bg-destructive/90"
                        >
                          Delete rule
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
