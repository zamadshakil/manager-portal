"use client"

import { FileIcon, X, Loader2, CheckCircle2, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"

export interface Attachment {
  id: string
  filename: string
  status: "uploading" | "ready" | "error"
  url?: string
}

interface FilePreviewProps {
  attachments: Attachment[]
  onRemove: (id: string) => void
}

export function FilePreview({ attachments, onRemove }: FilePreviewProps) {
  if (attachments.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 px-3.5 pb-2">
      {attachments.map((file) => (
        <div
          key={file.id}
          className={cn(
            "group relative flex items-center gap-2.5 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 transition-all hover:bg-muted/50",
            file.status === "error" && "border-destructive/20 bg-destructive/5"
          )}
        >
          <div className="flex h-7 w-7 items-center justify-center rounded bg-background shadow-sm">
            <FileIcon className="h-4 w-4 text-muted-foreground" />
          </div>
          
          <div className="min-w-0 max-w-[120px]">
            <p className="truncate text-[12px] font-medium leading-tight">
              {file.filename}
            </p>
            <div className="flex items-center gap-1">
              {file.status === "uploading" ? (
                <>
                  <Loader2 className="h-2.5 w-2.5 animate-spin text-primary" />
                  <span className="text-[10px] text-muted-foreground">Uploading...</span>
                </>
              ) : file.status === "ready" ? (
                <>
                  <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" />
                  <span className="text-[10px] text-muted-foreground">Ready</span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-2.5 w-2.5 text-destructive" />
                  <span className="text-[10px] text-destructive">Failed</span>
                </>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onRemove(file.id)}
            className="ml-1 rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
            aria-label={`Remove ${file.filename}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
