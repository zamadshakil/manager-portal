"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Pencil, Loader2, XCircle, MailCheck, MailWarning, Send, Ban } from "lucide-react"
import {
  updateUserProfile,
  cancelPendingEmailChange,
  resendEmailChangeVerification,
} from "@/app/actions/users"
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
  const [success, setSuccess] = useState<string | null>(null)

  if (!isOpen) return null

  const hasPending = !!user.pending_email
  const pendingEmail = user.pending_email ?? null
  const expiresAt = user.email_change_token_expires_at ?? null

  const isDirty =
    fullName.trim() !== (user.full_name ?? "").trim() ||
    email.trim().toLowerCase() !== (user.email ?? "").trim().toLowerCase()

  const isEmailChange =
    email.trim().toLowerCase() !== (user.email ?? "").trim().toLowerCase() && email.trim().length > 0

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isDirty) return
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      const result = await updateUserProfile(user.id, fullName.trim(), email.trim())
      if (result.ok) {
        router.refresh()
        if (result.pendingEmail) {
          setSuccess(`Verification email sent to ${result.pendingEmail}. The change will take effect once they confirm.`)
        } else {
          onClose()
        }
      } else {
        setError(result.error ?? "An unexpected error occurred.")
      }
    })
  }

  function handleCancelPending() {
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      const res = await cancelPendingEmailChange(user.id)
      if (res.ok) {
        router.refresh()
        setSuccess("Pending email change cancelled.")
      } else {
        setError(res.error ?? "Could not cancel the pending change.")
      }
    })
  }

  function handleResendVerification() {
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      const res = await resendEmailChangeVerification(user.id)
      if (res.ok) {
        router.refresh()
        setSuccess(`Verification email resent${pendingEmail ? ` to ${pendingEmail}` : ""}.`)
      } else {
        setError(res.error ?? "Could not resend the verification email.")
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
              {isEmailChange && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
                  <MailWarning className="h-3.5 w-3.5 shrink-0 mt-[1px]" />
                  <span>
                    A verification link will be sent to the <strong>new address</strong>.
                    The change only takes effect after the user confirms it — until then,
                    they keep signing in with the current email.
                  </span>
                </p>
              )}
            </div>

            {/* Pending verification banner — shown when there is already an
                outstanding email change request for this user. */}
            {hasPending && (
              <div className="rounded-xl border border-amber-300/60 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10 p-3.5 space-y-2.5">
                <div className="flex items-start gap-2">
                  <MailWarning className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-[2px]" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-semibold text-amber-900 dark:text-amber-200">
                      Email under verification
                    </p>
                    <p className="text-[11.5px] text-amber-800/80 dark:text-amber-200/80 leading-relaxed">
                      Pending change to{" "}
                      <span className="font-mono font-semibold break-all">{pendingEmail}</span>
                      {expiresAt ? (
                        <>
                          {" "}— link expires{" "}
                          {new Date(expiresAt).toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                          .
                        </>
                      ) : (
                        "."
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 pl-6">
                  <button
                    type="button"
                    onClick={handleResendVerification}
                    disabled={isPending}
                    className="inline-flex items-center gap-1.5 rounded-md border border-amber-300/70 bg-white/70 px-2.5 py-1.5 text-[11.5px] font-semibold text-amber-900 transition-colors hover:bg-white disabled:opacity-50 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200 dark:hover:bg-amber-500/25"
                  >
                    <Send className="h-3.5 w-3.5" aria-hidden="true" />
                    Resend verification
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelPending}
                    disabled={isPending}
                    className="inline-flex items-center gap-1.5 rounded-md border border-amber-300/70 bg-white/70 px-2.5 py-1.5 text-[11.5px] font-semibold text-amber-900 transition-colors hover:bg-white disabled:opacity-50 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200 dark:hover:bg-amber-500/25"
                  >
                    <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                    Cancel pending change
                  </button>
                </div>
              </div>
            )}

            {/* Success banner */}
            {success && (
              <p className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-400 flex items-start gap-1.5 animate-in slide-in-from-top-2">
                <MailCheck className="h-4 w-4 shrink-0 mt-[1px]" aria-hidden="true" />
                <span>{success}</span>
              </p>
            )}

            {/* Error */}
            {error && (
              <p className="text-[12px] font-bold text-destructive flex items-start gap-1.5 animate-in slide-in-from-top-2">
                <XCircle className="h-4 w-4 shrink-0 mt-[1px]" />
                <span>{error}</span>
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
