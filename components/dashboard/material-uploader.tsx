"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { FolderOpen, Loader2 } from "lucide-react"
import { createMaterial } from "@/app/actions/materials"

export function MaterialUploader() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [tags, setTags] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!file) {
      setError("Choose a file.")
      return
    }
    const fd = new FormData()
    fd.set("file", file)
    fd.set("title", title.trim())
    fd.set("description", description.trim())
    fd.set("tags", tags.trim())
    start(async () => {
      const res = await createMaterial(fd)
      if (!res.ok) {
        setError(res.error ?? "Failed to upload.")
        return
      }
      setFile(null)
      setTitle("")
      setDescription("")
      setTags("")
      if (inputRef.current) inputRef.current.value = ""
      router.refresh()
    })
  }

  return (
    <section
      aria-labelledby="material-uploader"
      className="rounded-xl border border-border bg-card shadow-card"
    >
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 lg:px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f0f8f4] text-[#1aae39]">
          <FolderOpen className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 id="material-uploader" className="text-[15px] font-semibold tracking-tight">
            Add material
          </h2>
          <p className="text-[12px] text-muted-foreground">
            Share reference files with your team.
          </p>
        </div>
      </header>
      <form onSubmit={onSubmit} className="p-4 lg:p-5 space-y-3">
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null
            setFile(f)
            if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ""))
          }}
          className="block w-full text-[12px] file:mr-3 file:rounded-lg file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-[12px] file:font-semibold hover:file:bg-muted"
        />
        <label className="block">
          <span className="text-[12px] font-semibold text-muted-foreground">Title</span>
          <input
            type="text"
            required
            minLength={2}
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="block">
          <span className="text-[12px] font-semibold text-muted-foreground">Description</span>
          <textarea
            rows={2}
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="block">
          <span className="text-[12px] font-semibold text-muted-foreground">
            Tags (comma separated)
          </span>
          <input
            type="text"
            maxLength={500}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="onboarding, compliance, q2"
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        {error ? (
          <p role="alert" className="text-[12px] font-semibold text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!file || pending}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 h-9 text-[13px] font-semibold text-primary-foreground transition-all hover:bg-[#005bab] active:scale-[0.97] disabled:opacity-60"
          >
            {pending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Uploading…
              </>
            ) : (
              "Upload material"
            )}
          </button>
        </div>
      </form>
    </section>
  )
}
