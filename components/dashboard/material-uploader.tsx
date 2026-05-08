"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { FolderOpen, Loader2 } from "lucide-react"
import { createMaterial } from "@/app/actions/materials"
import { ARCHIVE_MIME_TYPES, MAX_FILE_SIZE_BYTES } from "@/lib/types"
import type { UserRole } from "@/lib/types"

const ARCHIVE_MIMES = new Set<string>(ARCHIVE_MIME_TYPES as readonly string[])

export function MaterialUploader({
  role,
  teams,
  currentTeamId,
}: {
  role: UserRole
  teams: { id: string; name: string }[]
  currentTeamId: string | null
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [tags, setTags] = useState("")
  const [target, setTarget] = useState<string>("global")
  const [expiresAt, setExpiresAt] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  // Large-archive presigned upload state
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [uploadStage, setUploadStage] = useState<"" | "presigning" | "uploading" | "processing">("")

  const effectiveTarget = role === "manager" && currentTeamId ? currentTeamId : target
  const isLargeArchive =
    file !== null &&
    ARCHIVE_MIMES.has(file.type) &&
    file.size > MAX_FILE_SIZE_BYTES
  const isOversized =
    file !== null &&
    !ARCHIVE_MIMES.has(file.type) &&
    file.size > MAX_FILE_SIZE_BYTES

  async function handleLargeArchiveUpload() {
    if (!file) return
    setError(null)
    setUploadProgress(0)
    let succeeded = false

    try {
      // Step 1: Get presigned URL
      setUploadStage("presigning")
      const presignRes = await fetch("/api/materials/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          tags: tags.trim() || undefined,
          target: effectiveTarget,
          expiresAt: expiresAt || undefined,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      })
      const presignData = await presignRes.json()
      if (!presignRes.ok) {
        setError(presignData.error ?? "Could not get upload URL.")
        return
      }
      const { materialId } = presignData as {
        materialId: string
      }

      // Step 2: Upload via server proxy (avoids browser-to-R2 CORS restriction)
      setUploadStage("uploading")
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        const fd = new FormData()
        fd.append("materialId", materialId)
        fd.append("file", file)
        xhr.open("POST", "/api/materials/upload-proxy")
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploadProgress(Math.round((e.loaded / e.total) * 100))
          }
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve()
          } else {
            let msg = `Upload failed (HTTP ${xhr.status})`
            try {
              const data = JSON.parse(xhr.responseText)
              if (data.error) msg = data.error
            } catch {}
            reject(new Error(msg))
          }
        }
        xhr.onerror = () => reject(new Error("Network error during upload"))
        xhr.send(fd)
      })
      setUploadProgress(100)

      succeeded = true
      setUploadStage("processing")
      setFile(null)
      setTitle("")
      setDescription("")
      setTags("")
      setExpiresAt("")
      if (inputRef.current) inputRef.current.value = ""
      router.refresh()
    } catch (err: any) {
      setError(err?.message ?? "Upload failed.")
    } finally {
      if (!succeeded) {
        setUploadStage("")
        setUploadProgress(null)
      }
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!file) {
      setError("Choose a file.")
      return
    }

    // Reject non-archive files that exceed the server action body limit
    if (!ARCHIVE_MIMES.has(file.type) && file.size > MAX_FILE_SIZE_BYTES) {
      setError(`File exceeds the 25 MB limit (${(file.size / 1024 / 1024).toFixed(1)} MB). Please compress it or choose a smaller file.`)
      return
    }

    if (isLargeArchive) {
      void handleLargeArchiveUpload()
      return
    }

    const fd = new FormData()
    fd.set("file", file)
    fd.set("title", title.trim())
    fd.set("description", description.trim())
    fd.set("tags", tags.trim())
    fd.set("target", effectiveTarget)
    if (expiresAt) fd.set("expiresAt", expiresAt)

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
      setExpiresAt("")
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
          accept=".pdf,.doc,.docx,.txt,.ppt,.pptx,.png,.jpg,.jpeg,.xlsx,.md,.zip,.rar"
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

        <label className="block">
          <span className="text-[12px] font-semibold text-muted-foreground">Expires At (optional)</span>
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        {role === "main_admin" ? (
          <label className="block">
            <span className="text-[12px] font-semibold text-muted-foreground">Target Audience</span>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="global">Global (All Teams)</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {isOversized && (
          <p className="text-[12px] font-semibold text-destructive">
            File is {(file!.size / 1024 / 1024).toFixed(1)} MB — maximum is 25 MB for non-archive files. Please compress it or use a ZIP archive.
          </p>
        )}

        {isLargeArchive && (
          <p className="text-[11px] text-muted-foreground">
            Large archive (&gt;25 MB) — will upload to storage and extract content in the background.
          </p>
        )}

        {uploadProgress !== null && (
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>
                {uploadStage === "presigning" && "Preparing upload…"}
                {uploadStage === "uploading" && `Uploading… ${uploadProgress}%`}
              </span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-200"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        {uploadStage === "processing" && (
          <p className="text-[12px] font-semibold text-amber-600 dark:text-amber-400">
            Archive uploaded — extracting content in background…
          </p>
        )}

        {error ? (
          <p role="alert" className="text-[12px] font-semibold text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!file || pending || uploadProgress !== null || isOversized}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 h-9 text-[13px] font-semibold text-primary-foreground transition-all hover:bg-[#005bab] active:scale-[0.97] disabled:opacity-60"
          >
            {pending || uploadProgress !== null ? (
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
