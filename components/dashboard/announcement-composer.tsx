"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Megaphone, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { createAnnouncement } from "@/app/actions/announcements"
import type { UserRole } from "@/lib/types"

const PRIORITIES = [
  { id: "low", label: "Low" },
  { id: "normal", label: "Normal" },
  { id: "high", label: "High" },
  { id: "urgent", label: "Urgent" },
] as const

export function AnnouncementComposer({ role }: { role: UserRole }) {
  const router = useRouter()
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]["id"]>("normal")
  const [scope, setScope] = useState<"team" | "global">("team")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData()
    fd.set("title", title.trim())
    fd.set("body", body.trim())
    fd.set("priority", priority)
    fd.set("scope", scope)
    start(async () => {
      const res = await createAnnouncement(fd)
      if (!res.ok) {
        setError(res.error ?? "Failed to post.")
        return
      }
      setTitle("")
      setBody("")
      setPriority("normal")
      router.refresh()
    })
  }

  return (
    <section
      aria-labelledby="announcement-composer"
      className="rounded-xl border border-border bg-card shadow-card"
    >
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 lg:px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#fef6e6] text-[#a36800]">
          <Megaphone className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 id="announcement-composer" className="text-[15px] font-semibold tracking-tight">
            Post announcement
          </h2>
          <p className="text-[12px] text-muted-foreground">
            Broadcast to your team — visible immediately on every member dashboard.
          </p>
        </div>
      </header>

      <form onSubmit={onSubmit} className="p-4 lg:p-5 space-y-3">
        <label className="block">
          <span className="text-[12px] font-semibold text-muted-foreground">Title</span>
          <input
            type="text"
            required
            minLength={2}
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What is happening?"
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="block">
          <span className="text-[12px] font-semibold text-muted-foreground">Message</span>
          <textarea
            required
            minLength={2}
            maxLength={5_000}
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Provide details, deadlines and any context the team needs."
            className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-xl border border-border bg-background p-1">
            {PRIORITIES.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => setPriority(p.id)}
                aria-pressed={priority === p.id}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-[12px] font-semibold transition-colors",
                  priority === p.id
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          {role === "main_admin" ? (
            <label className="flex items-center gap-1.5 text-[12px] font-semibold">
              <input
                type="checkbox"
                checked={scope === "global"}
                onChange={(e) => setScope(e.target.checked ? "global" : "team")}
                className="rounded border-border"
              />
              Global (all teams)
            </label>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 h-9 text-[13px] font-semibold text-primary-foreground transition-all hover:bg-[#005bab] active:scale-[0.97] disabled:opacity-60"
          >
            {pending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Posting…
              </>
            ) : (
              "Post announcement"
            )}
          </button>
        </div>

        {error ? (
          <p role="alert" className="text-[12px] font-semibold text-destructive">
            {error}
          </p>
        ) : null}
      </form>
    </section>
  )
}
