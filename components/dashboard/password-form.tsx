"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { KeyRound, Loader2, Check } from "lucide-react"
import { updatePassword } from "@/app/actions/profile"

export function PasswordForm({ mustReset }: { mustReset: boolean }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, start] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    const form = e.currentTarget
    const fd = new FormData(form)
    start(async () => {
      const res = await updatePassword(fd)
      if (!res.ok) {
        setError(res.error ?? "Could not change password.")
        return
      }
      setSaved(true)
      form.reset()
      // Session was invalidated server-side. Force a full navigation to the
      // login page so the user must re-authenticate with the new password.
      setTimeout(() => {
        window.location.href = "/auth/login?password_changed=1"
      }, 800)
    })
  }

  return (
    <section className="rounded-xl border border-border bg-card shadow-card">
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 lg:px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-warm-white">
          <KeyRound className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">Password</h2>
          <p className="text-[12px] text-muted-foreground">
            {mustReset
              ? "Choose a new password — your administrator created this account with a temporary one."
              : "Update your account password."}
          </p>
        </div>
      </header>
      <form onSubmit={onSubmit} className="p-4 lg:p-5 space-y-3">
        <label className="block">
          <span className="text-[12px] font-semibold text-muted-foreground">New password</span>
          <input
            name="new_password"
            type="password"
            required
            minLength={8}
            maxLength={72}
            autoComplete="new-password"
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="block">
          <span className="text-[12px] font-semibold text-muted-foreground">Confirm password</span>
          <input
            name="confirm_password"
            type="password"
            required
            minLength={8}
            maxLength={72}
            autoComplete="new-password"
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        {error ? (
          <p role="alert" className="text-[12px] font-semibold text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex items-center justify-end gap-2">
          {saved ? (
            <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#1aae39]">
              <Check className="h-3.5 w-3.5" aria-hidden="true" /> Updated
            </span>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 h-9 text-[13px] font-semibold text-primary-foreground transition-all hover:bg-[#005bab] active:scale-[0.97] disabled:opacity-60"
          >
            {pending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Updating…
              </>
            ) : (
              "Update password"
            )}
          </button>
        </div>
      </form>
    </section>
  )
}
