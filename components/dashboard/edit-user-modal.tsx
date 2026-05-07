"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Pencil, Loader2, XCircle, CheckCircle2 } from "lucide-react"
import { updateUserProfile } from "@/app/actions/users"
import type { Profile } from "@/lib/types"

interface Props {
  user: Profile
  isOpen: boolean
  onClose: () => void
}

export function EditUserModal({ user, isOpen, onClose }: Props) {
  const router = useRouter()
  const [fullName, setFullName] = useState(user.full_name ?? "")
  const [email, setEmail] = useState(user.email ?? "")
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const isDirty = fullName.trim() !== (user.full_name ?? "").trim() || email.trim() !== (user.email ?? "").trim()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isDirty) return
    setError(null)
    startTransition(async () => {
      const result = await updateUserProfile(user.id, fullName.trim(), email.trim())
      if (result.ok) {
        router.refresh()
        onClose()
      } else {
        setError(result.error ?? "An unexpected error occurred.")
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-2xl animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-user-heading"
      >
        {/* Header */}
        <header className="border-b border-border bg-muted/30 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Pencil className="h-5 w-5" />
            </div>
            <div>
              <h2 id="edit-user-heading" className="text-lg font-bold tracking-tight">
                Edit user profile
              </h2>
              <p className="text-xs text-muted-foreground font-medium">
                Update name or email for this account
              </p>
            </div>
          </div>
        </header>

        <form onSubmit={handleSubmit}>
          <div className="p-6 space-y-4">
            {/* Current account info */}
            <div className="rounded-xl border border-border bg-muted/20 px-4 py-3 flex items-center gap-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-[12px] font-semibold select-none">
                {(user.full_name ?? user.email)
                  .split(/\s+|@/)
                  .map((p) => p[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join("")
                  .toUpperCase() || "U"}
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold truncate">{user.full_name ?? "—"}</p>
                <p className="text-[11.5px] text-muted-foreground truncate">{user.email}</p>
              </div>
            </div>

            {/* Full name field */}
            <div className="space-y-1.5">
              <label htmlFor="edit-full-name" className="text-[12px] font-semibold text-muted-foreground">
                Full name
              </label>
              <input
                id="edit-full-name"
                type="text"
                required
                minLength={1}
                maxLength={200}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                disabled={isPending}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                autoComplete="off"
              />
            </div>

            {/* Email field */}
            <div className="space-y-1.5">
              <label htmlFor="edit-email" className="text-[12px] font-semibold text-muted-foreground">
                Email address
              </label>
              <input
                id="edit-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isPending}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                autoComplete="off"
              />
              {email.trim() !== (user.email ?? "").trim() && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 shrink-0" />
                  Email change will take effect immediately. The user's next login must use the new address.
                </p>
              )}
            </div>

            {/* Error */}
            {error && (
              <p className="text-[12px] font-bold text-destructive flex items-center gap-1.5 animate-in slide-in-from-top-2">
                <XCircle className="h-4 w-4 shrink-0" />
                {error}
              </p>
            )}
          </div>

          {/* Footer */}
          <footer className="flex items-center justify-end gap-3 border-t border-border bg-muted/30 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="rounded-lg px-4 py-2 text-[13px] font-semibold hover:bg-muted transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || !isDirty}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2 text-[13px] font-bold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:grayscale disabled:hover:scale-100"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save changes"
              )}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
