"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CloudUpload, FileType2, Loader2, AlertTriangle, CheckCircle2, XCircle, Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { createSubmission } from "@/app/actions/submissions"
import { usePipeline } from "@/hooks/use-pipeline"

const ACCEPTED_EXT = [".pdf", ".doc", ".docx", ".ppt", ".pptx", ".txt", ".png", ".jpg", ".jpeg", ".xlsx", ".md"]

interface TaskSubmissionFormProps {
  taskId: string
  taskTitle: string
  dueAt: string | null
  allowLate: boolean
  lateSubmissionDeadline: string | null
  requireLateReason: boolean
}

/**
 * Member-side submission form for a specific task. Computes whether the
 * deadline has passed live, hides the late-reason field until needed, and
 * blocks submission entirely when `allow_late` is false on an overdue task —
 * matching the server-side enforcement in `createSubmission`.
 *
 * After upload, triggers the AI pipeline via POST /api/pipeline/[id] and
 * shows live progress (queued → parsing → validating → passed/failed).
 */
export function TaskSubmissionForm({
  taskId,
  taskTitle,
  dueAt,
  allowLate,
  lateSubmissionDeadline,
  requireLateReason,
}: TaskSubmissionFormProps) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState(taskTitle)
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [dragOver, setDragOver] = useState(false)
  const [uploaded, setUploaded] = useState(false)

  const pipeline = usePipeline({ refreshOnComplete: true })

  const due = dueAt ? new Date(dueAt) : null
  const overdue = due ? due.getTime() < Date.now() : false
  const lateDeadline = lateSubmissionDeadline ? new Date(lateSubmissionDeadline).getTime() : null
  const pastLateDeadline = lateDeadline ? lateDeadline < Date.now() : false
  const blocked = (overdue && !allowLate) || pastLateDeadline
  const reasonRequired = overdue && requireLateReason

  function pickFile(f: File | null) {
    setFile(f)
    setError(null)
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (blocked) {
      setError("Submission failed: the deadline has passed and late submissions are not allowed.")
      return
    }
    if (!file) {
      setError("Choose a file to upload.")
      return
    }
    if (title.trim().length < 2) {
      setError("Add a short title (2+ characters).")
      return
    }
    if (reasonRequired && reason.trim().length < 8) {
      setError("Late submission requires a reason (at least 8 characters).")
      return
    }
    const fd = new FormData()
    fd.set("file", file)
    fd.set("title", title.trim())
    fd.set("taskId", taskId)
    if (overdue) fd.set("lateReason", reason.trim())

    startTransition(async () => {
      const res = await createSubmission(fd)
      if (!res.ok) {
        setError(res.error ?? "Submission failed.")
        return
      }
      // Upload succeeded — trigger the AI pipeline and start polling.
      setUploaded(true)
      if (res.submissionId) {
        pipeline.trigger(res.submissionId)
      }
    })
  }

  // Show pipeline progress after upload.
  if (uploaded && pipeline.status !== "idle") {
    return <PipelineProgress status={pipeline.status} score={pipeline.score} />
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {overdue ? (
        <div
          role="alert"
          className={cn(
            "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[12.5px] font-medium",
            blocked
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-amber-300 bg-amber-50 text-amber-900",
          )}
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {blocked
              ? "The deadline has passed and this task does not allow late submissions."
              : "The deadline has passed. You can still submit but a reason is required."}
          </span>
        </div>
      ) : null}

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
        disabled={blocked}
        className={cn(
          "w-full rounded-xl border border-dashed p-5 text-left transition-colors",
          blocked
            ? "border-border bg-muted/40 cursor-not-allowed opacity-60"
            : dragOver
              ? "border-primary bg-[#f2f9ff]"
              : "border-border bg-warm-white hover:bg-muted",
        )}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-background border border-border">
            {file ? (
              <FileType2 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            ) : (
              <CloudUpload className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            )}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[13.5px] font-semibold truncate">
              {file ? file.name : "Drop file or click to browse"}
            </p>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              Up to 25 MB · PDF, DOC, DOCX, TXT, PPT, PNG, JPG, XLSX, MD
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

      <div className="grid gap-1.5">
        <Label htmlFor="title">Submission title</Label>
        <Input
          id="title"
          required
          minLength={2}
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={blocked}
        />
      </div>

      {overdue && allowLate ? (
        <div className="grid gap-1.5">
          <Label htmlFor="lateReason">
            Reason for late submission{requireLateReason ? " (required)" : ""}
          </Label>
          <Textarea
            id="lateReason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Briefly explain what caused the delay."
            maxLength={1000}
          />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-[12.5px] font-semibold text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-end">
        <Button type="submit" disabled={!file || pending || blocked}>
          {pending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Uploading…
            </>
          ) : overdue ? (
            "Submit late"
          ) : (
            "Submit task"
          )}
        </Button>
      </div>
    </form>
  )
}

// ── Pipeline Progress Component ────────────────────────────────────────────
const STATUS_CONFIG = {
  queued: {
    icon: Clock,
    label: "Queued",
    detail: "Your file is uploaded. AI validation is starting…",
    color: "text-muted-foreground",
    bg: "bg-muted/50",
    animate: true,
  },
  parsing: {
    icon: Loader2,
    label: "Parsing document",
    detail: "Extracting text from your document…",
    color: "text-blue-600",
    bg: "bg-blue-50",
    animate: true,
  },
  validating: {
    icon: Loader2,
    label: "AI validation in progress",
    detail: "Running validation rules against your document…",
    color: "text-primary",
    bg: "bg-[#f2f9ff]",
    animate: true,
  },
  passed: {
    icon: CheckCircle2,
    label: "Passed",
    detail: "Your submission passed all validation rules.",
    color: "text-green-600",
    bg: "bg-green-50",
    animate: false,
  },
  failed: {
    icon: XCircle,
    label: "Needs attention",
    detail: "Some validation checks did not pass. Review the details below.",
    color: "text-destructive",
    bg: "bg-destructive/5",
    animate: false,
  },
  needs_review: {
    icon: AlertTriangle,
    label: "Pending review",
    detail: "Your submission needs manual review from your manager.",
    color: "text-amber-600",
    bg: "bg-amber-50",
    animate: false,
  },
  late_submitted: {
    icon: CheckCircle2,
    label: "Submitted (late)",
    detail: "Your late submission has been processed.",
    color: "text-amber-600",
    bg: "bg-amber-50",
    animate: false,
  },
} as const

function PipelineProgress({
  status,
  score,
}: {
  status: string
  score: number | null
}) {
  const config = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.queued
  const Icon = config.icon

  return (
    <div className={cn("rounded-xl border border-border p-5", config.bg)}>
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5", config.color)}>
          <Icon
            className={cn("h-5 w-5", config.animate && "animate-spin")}
            aria-hidden="true"
          />
        </span>
        <div className="flex-1 min-w-0">
          <p className={cn("text-[14px] font-semibold", config.color)}>
            {config.label}
          </p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {config.detail}
          </p>
          {score !== null && (
            <p className="mt-2 text-[13px] font-semibold">
              Score: {score}/100
            </p>
          )}
          {config.animate && (
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-border/50">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/60" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
