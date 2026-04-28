"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CloudUpload, FileType2, Sparkles, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { createSubmission } from "@/app/actions/submissions"

const ACCEPTED_EXT = [".pdf", ".doc", ".docx", ".ppt", ".pptx", ".png", ".jpg", ".jpeg"]

export function UploadCard() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState("")
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function pickFile(f: File | null) {
    setFile(f)
    setError(null)
    if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ""))
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!file) {
      setError("Choose a file to upload.")
      return
    }
    if (title.trim().length < 2) {
      setError("Add a short title (2+ characters).")
      return
    }
    const fd = new FormData()
    fd.set("file", file)
    fd.set("title", title.trim())
    startTransition(async () => {
      const result = await createSubmission(fd)
      if (!result.ok) {
        setError(result.error ?? "Upload failed.")
        return
      }
      setFile(null)
      setTitle("")
      if (inputRef.current) inputRef.current.value = ""
      router.refresh()
    })
  }

  return (
    <section
      aria-labelledby="upload-heading"
      className="rounded-xl border border-border bg-card shadow-card"
    >
      <header className="px-4 py-3.5 lg:px-5 border-b border-border flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f2f9ff] text-[#097fe8]">
          <CloudUpload className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 id="upload-heading" className="text-[15px] font-semibold tracking-tight">
            New submission
          </h2>
          <p className="text-[12px] text-muted-foreground">
            Upload — the LLM pipeline validates asynchronously.
          </p>
        </div>
      </header>

      <form onSubmit={onSubmit} className="p-4 lg:p-5 space-y-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const f = e.dataTransfer.files?.[0]
            if (f) pickFile(f)
          }}
          className={cn(
            "w-full rounded-xl border border-dashed p-5 text-left transition-colors",
            dragOver
              ? "border-primary bg-[#f2f9ff]"
              : "border-border bg-warm-white hover:bg-muted",
          )}
        >
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-background border border-border">
              <FileType2 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[13.5px] font-semibold">
                {file ? file.name : "Drop file or click to browse"}
              </p>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                Up to 25 MB · PDF, DOC, PPT, PNG, JPG
              </p>
            </div>
          </div>
        </button>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXT.join(",")}
          className="sr-only"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
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
            placeholder="e.g. Q2 compliance report"
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        {error ? (
          <p role="alert" className="text-[12px] font-semibold text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            AI summary in seconds
          </p>
          <button
            type="submit"
            disabled={!file || pending}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl px-3.5 h-9 text-[13px] font-semibold transition-all",
              file && !pending
                ? "bg-primary text-primary-foreground hover:bg-[#005bab] active:scale-[0.97]"
                : "bg-muted text-muted-foreground cursor-not-allowed",
            )}
          >
            {pending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Uploading…
              </>
            ) : (
              "Submit for validation"
            )}
          </button>
        </div>
      </form>
    </section>
  )
}
