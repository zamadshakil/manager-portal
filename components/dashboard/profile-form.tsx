"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { User, Loader2, Check, Image as ImageIcon, Mail, MailWarning, MailCheck, Ban, RefreshCw, XCircle, ChevronDown } from "lucide-react"
import { updateProfile } from "@/app/actions/profile"
import { updateUserProfile, cancelPendingEmailChange, resendEmailChangeVerification } from "@/app/actions/users"
import type { Profile } from "@/lib/types"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

export function ProfileForm({ profile }: { profile: Profile }) {
  const router = useRouter()
  const [name, setName] = useState(profile.full_name ?? "")
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, start] = useTransition()
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatar_url)

  // Email-change state — main_admin only
  const isMainAdmin = profile.role === "main_admin"
  const [showEmailChange, setShowEmailChange] = useState(false)
  const [newEmail, setNewEmail] = useState("")
  const [pendingEmail, setPendingEmail] = useState<string | null>(profile.pending_email ?? null)
  const [pendingExpiry, setPendingExpiry] = useState<string | null>(profile.email_change_token_expires_at ?? null)
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [emailPending, startEmail] = useTransition()
  const [cancelPendingT, startCancel] = useTransition()
  const [resendPendingT, startResend] = useTransition()

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

  function onEmailChangeSubmit(e?: React.FormEvent | React.MouseEvent | React.KeyboardEvent) {
    e?.preventDefault()
    if (!newEmail.trim()) return
    setEmailError(null)
    setEmailSuccess(null)
    startEmail(async () => {
      const res = await updateUserProfile(profile.id, profile.full_name ?? name, newEmail.trim())
      if (!res.ok) {
        setEmailError(res.error ?? "Could not initiate email change.")
        return
      }
      if (res.pendingEmail) {
        setPendingEmail(res.pendingEmail)
        setPendingExpiry(null)
        setEmailSuccess(`Verification email sent to ${res.pendingEmail}. Click the link in that inbox to confirm.`)
        setNewEmail("")
        setShowEmailChange(false)
      }
    })
  }

  function onCancelEmailChange() {
    setEmailError(null)
    setEmailSuccess(null)
    startCancel(async () => {
      const res = await cancelPendingEmailChange(profile.id)
      if (!res.ok) {
        setEmailError(res.error ?? "Could not cancel.")
        return
      }
      setPendingEmail(null)
      setPendingExpiry(null)
      setEmailSuccess("Pending email change cancelled.")
    })
  }

  function onResendEmailChange() {
    setEmailError(null)
    setEmailSuccess(null)
    startResend(async () => {
      const res = await resendEmailChangeVerification(profile.id)
      if (!res.ok) {
        setEmailError(res.error ?? "Could not resend.")
        return
      }
      setEmailSuccess(`Verification email resent to ${pendingEmail}.`)
    })
  }

  async function downscaleToWebp(file: File, size = 256, quality = 0.9): Promise<Blob> {
    const bitmap = await createImageBitmap(file)
    try {
      const dim = Math.min(bitmap.width, bitmap.height)
      const sx = Math.max(0, Math.floor((bitmap.width - dim) / 2))
      const sy = Math.max(0, Math.floor((bitmap.height - dim) / 2))
      const canvas = document.createElement("canvas")
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext("2d")
      if (!ctx) throw new Error("Image processing is not supported in this browser")
      ctx.drawImage(bitmap, sx, sy, dim, dim, 0, 0, size, size)
      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality))
      if (!blob) throw new Error("Failed to encode image")
      return blob
    } finally {
      bitmap.close()
    }
  }

  async function onPickAvatar(file?: File | null) {
    if (!file) return
    setAvatarError(null)
    setSaved(false)
    if (!file.type.startsWith("image/")) {
      setAvatarError("Select an image file")
      return
    }
    try {
      setAvatarUploading(true)
      const processed = await downscaleToWebp(file, 256, 0.9)
      const fd = new FormData()
      fd.append("file", new File([processed], "avatar.webp", { type: "image/webp" }))
      const res = await fetch("/api/uploads/avatar", { method: "POST", body: fd })
      const data = (await res.json()) as { ok: boolean; url?: string; error?: string }
      if (!res.ok) throw new Error(data.error || "Upload failed")
      if (!data.ok || !data.url) throw new Error(data.error || "Upload failed")
      setAvatarUrl(data.url)
      setSaved(true)
      router.refresh()
    } catch (err: unknown) {
      setAvatarError(err instanceof Error ? err.message : "Could not upload avatar")
    } finally {
      setAvatarUploading(false)
    }
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
        <div className="flex items-center gap-3">
          <Avatar className="h-14 w-14">
            <AvatarImage src={avatarUrl ?? undefined} alt="Avatar" />
            <AvatarFallback className="text-xs">
              {(profile.full_name || profile.email || "").slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col gap-1">
            <div className="text-[12px] font-semibold text-muted-foreground">Profile picture</div>
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-1.5 rounded-xl bg-muted px-3 h-8 text-[12px] font-semibold cursor-pointer hover:bg-accent transition-colors">
                <ImageIcon className="h-3.5 w-3.5" />
                {avatarUploading ? "Uploading…" : "Upload new"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={avatarUploading}
                  onChange={(e) => {
                    const file = e.currentTarget.files?.[0]
                    e.currentTarget.value = ""
                    void onPickAvatar(file)
                  }}
                />
              </label>
              <span className="text-[11px] text-muted-foreground">WebP, square, max 350KB</span>
            </div>
            {avatarError ? (
              <p role="alert" className="text-[12px] font-semibold text-destructive">{avatarError}</p>
            ) : null}
          </div>
        </div>
        {/* Email section */}
        {isMainAdmin ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold text-muted-foreground mb-0.5">Email</p>
                <p className="text-[13px] font-mono truncate">{profile.email}</p>
              </div>
              {!pendingEmail && (
                <button
                  type="button"
                  onClick={() => { setShowEmailChange((v) => !v); setEmailError(null); setEmailSuccess(null) }}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 h-8 text-[12px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                  {showEmailChange ? "Cancel" : "Change"}
                  {!showEmailChange && <ChevronDown className="h-3 w-3" aria-hidden="true" />}
                </button>
              )}
            </div>

            {/* Pending banner */}
            {pendingEmail && (
              <div className="rounded-xl border border-amber-300/60 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <MailWarning className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-px" aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-amber-900 dark:text-amber-200">Email under verification</p>
                    <p className="text-[11.5px] text-amber-800/80 dark:text-amber-200/80 leading-relaxed">
                      Pending change to{" "}
                      <span className="font-mono font-semibold break-all">{pendingEmail}</span>
                      {pendingExpiry && (
                        <> — expires {new Date(pendingExpiry).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1.5 pl-6">
                  <button
                    type="button"
                    onClick={onResendEmailChange}
                    disabled={resendPendingT}
                    className="inline-flex items-center gap-1 rounded-lg bg-amber-100 dark:bg-amber-500/20 border border-amber-300/60 dark:border-amber-500/30 px-2.5 h-7 text-[11.5px] font-semibold text-amber-900 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-500/30 transition-colors disabled:opacity-50"
                  >
                    {resendPendingT ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    Resend link
                  </button>
                  <button
                    type="button"
                    onClick={onCancelEmailChange}
                    disabled={cancelPendingT}
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 h-7 text-[11.5px] font-semibold text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    {cancelPendingT ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />}
                    Cancel pending change
                  </button>
                </div>
              </div>
            )}

            {/* Change email — NOT a <form> to avoid nesting inside the outer profile form */}
            {showEmailChange && !pendingEmail && (
              <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2.5">
                <p className="text-[11.5px] text-muted-foreground leading-relaxed">
                  A verification link will be sent to the new address. Your current email stays active until confirmed.
                </p>
                <input
                  type="email"
                  placeholder="new@example.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onEmailChangeSubmit(e) } }}
                  disabled={emailPending}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="off"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                />
                <p className="text-[11px] text-muted-foreground">
                  We verify the address format and whether the email domain can receive mail before sending the verification email.
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => { setShowEmailChange(false); setNewEmail(""); setEmailError(null) }}
                    className="rounded-lg border border-border px-3 h-8 text-[12px] font-semibold hover:bg-muted transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={onEmailChangeSubmit}
                    disabled={emailPending || !newEmail.trim()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 h-8 text-[12px] font-semibold text-primary-foreground hover:bg-[#005bab] transition-colors disabled:opacity-60"
                  >
                    {emailPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending…</> : "Send verification"}
                  </button>
                </div>
              </div>
            )}

            {/* Email action feedback */}
            {emailSuccess && (
              <p className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-400 flex items-start gap-1.5">
                <MailCheck className="h-4 w-4 shrink-0 mt-px" aria-hidden="true" />
                <span>{emailSuccess}</span>
              </p>
            )}
            {emailError && (
              <p className="text-[12px] font-bold text-destructive flex items-start gap-1.5">
                <XCircle className="h-4 w-4 shrink-0 mt-px" />
                <span>{emailError}</span>
              </p>
            )}
          </div>
        ) : (
          <label className="block">
            <span className="text-[12px] font-semibold text-muted-foreground">Email</span>
            <input
              value={profile.email}
              disabled
              className="mt-1 w-full rounded-lg border border-border bg-muted px-3 py-2 text-[13px] text-muted-foreground"
            />
          </label>
        )}
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
