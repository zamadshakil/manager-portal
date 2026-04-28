"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { User, Loader2, Check } from "lucide-react"
import { updateProfile } from "@/app/actions/profile"
import type { Profile } from "@/lib/types"

export function ProfileForm({ profile }: { profile: Profile }) {
  const router = useRouter()
  const [name, setName] = useState(profile.full_name ?? "")
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, start] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    const fd = new FormData()
    fd.set("full_name", name.trim())
    start(async () => {
      const res = await updateProfile(fd)
      if (!res.ok) {
        setError(res.error ?? "Could not save.")
        return
      }
      setSaved(true)
      router.refresh()
    })
  }

  return (
    <section className="rounded-xl border border-border bg-card shadow-card">
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 lg:px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-warm-white">
          <User className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">Profile</h2>
          <p className="text-[12px] text-muted-foreground">Visible to your team and managers.</p>
        </div>
      </header>
      <form onSubmit={onSubmit} className="p-4 lg:p-5 space-y-3">
        <label className="block">
          <span className="text-[12px] font-semibold text-muted-foreground">Email</span>
          <input
            value={profile.email}
            disabled
            className="mt-1 w-full rounded-lg border border-border bg-muted px-3 py-2 text-[13px] text-muted-foreground"
          />
        </label>
        <label className="block">
          <span className="text-[12px] font-semibold text-muted-foreground">Full name</span>
          <input
            type="text"
            required
            minLength={1}
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
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
              <Check className="h-3.5 w-3.5" aria-hidden="true" /> Saved
            </span>
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
            ) : (
              "Save changes"
            )}
          </button>
        </div>
      </form>
    </section>
  )
}
