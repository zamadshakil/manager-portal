"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { User, Loader2, Check, Image as ImageIcon } from "lucide-react"
import { updateProfile } from "@/app/actions/profile"
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
