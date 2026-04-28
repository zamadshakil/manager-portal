"use client"

import { useRef, useState } from "react"
import { CloudUpload, FileType2, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

const accepted = [".pdf", ".doc", ".docx", ".ppt", ".pptx", ".png", ".jpg", ".jpeg"]

export function UploadCard() {
  const [dragOver, setDragOver] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <section
      aria-labelledby="upload-heading"
      className="rounded-xl border border-border bg-card shadow-card overflow-hidden"
    >
      <header className="px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f2f9ff] text-[#097fe8]">
            <CloudUpload className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h2 id="upload-heading" className="text-[16px] font-bold tracking-[-0.25px]">
              New submission
            </h2>
            <p className="text-[12px] font-medium text-muted-foreground">
              Upload — the LLM pipeline validates asynchronously
            </p>
          </div>
        </div>
      </header>

      <div className="p-5">
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
            if (f) setFile(f)
          }}
          className={cn(
            "w-full rounded-xl border border-dashed p-6 text-left transition-colors",
            dragOver
              ? "border-primary bg-[#f2f9ff]"
              : "border-border bg-warm-white hover:bg-muted",
          )}
          aria-label="Drop file here or click to upload"
        >
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-background border border-border">
              <FileType2 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-semibold tracking-[-0.125px]">
                {file ? file.name : "Drop file or click to browse"}
              </div>
              <p className="mt-0.5 text-[12px] font-medium text-muted-foreground">
                Up to 50 MB · Supports PDF, DOC, PPT, PNG, JPG
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {accepted.map((ext) => (
                  <span
                    key={ext}
                    className="rounded-full bg-background px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground tracking-[0.125px] border border-border"
                  >
                    {ext}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </button>

        <input
          ref={inputRef}
          type="file"
          accept={accepted.join(",")}
          className="sr-only"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />

        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            AI summary generated within seconds
          </p>
          <button
            type="button"
            disabled={!file}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl px-3.5 h-9 text-[13px] font-semibold transition-all",
              file
                ? "bg-primary text-primary-foreground hover:bg-[#005bab] active:scale-[0.97]"
                : "bg-muted text-muted-foreground cursor-not-allowed",
            )}
          >
            Submit for validation
          </button>
        </div>
      </div>
    </section>
  )
}
