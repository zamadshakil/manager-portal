"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { UserPlus, Loader2 } from "lucide-react"
import { provisionUser } from "@/app/actions/users"
import type { Team } from "@/lib/types"

export function ProvisionUserForm({ teams }: { teams: Team[] }) {
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
      const res = await provisionUser(fd)
      if (!res.ok) {
        setError(res.error ?? "Could not provision user.")
        return
      }
      const email = String(fd.get("email") || "")
      setSuccess(`Account created for ${email}. Share the temporary password securely.`)
      form.reset()
      router.refresh()
    })
  }

  return (
    <section
      aria-labelledby="provision-heading"
      className="rounded-xl border border-border bg-card shadow-card"
    >
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 lg:px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f2f9ff] text-primary">
          <UserPlus className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 id="provision-heading" className="text-[15px] font-semibold tracking-tight">
            Provision new user
          </h2>
          <p className="text-[12px] text-muted-foreground">
            Top-down provisioning — accounts are created with a temporary password.
          </p>
        </div>
      </header>
      <form onSubmit={onSubmit} className="p-4 lg:p-5 space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="text-[12px] font-semibold text-muted-foreground">Full name</span>
            <input
              name="full_name"
              required
              minLength={1}
              maxLength={200}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="block">
            <span className="text-[12px] font-semibold text-muted-foreground">Email</span>
            <input
              name="email"
              type="email"
              required
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="block">
            <span className="text-[12px] font-semibold text-muted-foreground">Role</span>
            <select
              name="role"
              required
              defaultValue="member"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="member">Team Member</option>
              <option value="manager">Manager</option>
              <option value="main_admin">Main Admin</option>
            </select>
          </label>
          <label className="block">
            <span className="text-[12px] font-semibold text-muted-foreground">Team</span>
            <select
              name="team_id"
              defaultValue=""
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">— Unassigned —</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block md:col-span-2">
            <span className="text-[12px] font-semibold text-muted-foreground">
              Temporary password
            </span>
            <input
              name="password"
              type="text"
              required
              minLength={8}
              maxLength={72}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <span className="mt-1 block text-[11px] text-muted-foreground">
              The user will be prompted to change it on first login.
            </span>
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

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 h-9 text-[13px] font-semibold text-primary-foreground transition-all hover:bg-[#005bab] active:scale-[0.97] disabled:opacity-60"
          >
            {pending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Creating…
              </>
            ) : (
              "Create account"
            )}
          </button>
        </div>
      </form>
    </section>
  )
}
