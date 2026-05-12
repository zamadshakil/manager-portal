import Link from "next/link"
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Loader2,
  Sparkles,
  XCircle,
} from "lucide-react"
import { SubmissionActions } from "@/components/dashboard/submission-actions"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { fileIconLabel, formatBytes, formatDeadline, formatRelative } from "@/lib/format"
import type { Submission, SubmissionStatus } from "@/lib/types"
import { cn } from "@/lib/utils"

type StepState = "done" | "current" | "upcoming"

interface MemberSubmissionJourneyProps {
  submission: Submission
  uploaderLabel: string
  canRetry: boolean
  canDelete: boolean
  taskTitle: string | null
  taskDueAt: string | null
}

const STATUS_META: Record<SubmissionStatus, {
  icon: typeof Clock
  title: string
  detail: string
  tone: string
  surface: string
}> = {
  queued: {
    icon: Clock,
    title: "Upload received",
    detail: "Your file is safely uploaded and waiting to begin processing.",
    tone: "text-muted-foreground",
    surface: "bg-muted/40",
  },
  parsing: {
    icon: Loader2,
    title: "Preparing your document",
    detail: "We are extracting text and preparing the document for review.",
    tone: "text-blue-600",
    surface: "bg-blue-50",
  },
  validating: {
    icon: Loader2,
    title: "Processing in progress",
    detail: "Your submission is being reviewed. Check back shortly for the result.",
    tone: "text-primary",
    surface: "bg-[#f2f9ff]",
  },
  passed: {
    icon: CheckCircle2,
    title: "Submission approved",
    detail: "Your submission passed review. No further action is needed unless your manager requests changes.",
    tone: "text-green-600",
    surface: "bg-green-50",
  },
  failed: {
    icon: XCircle,
    title: "Updates likely needed",
    detail: "Your submission needs attention. Revisit the task and prepare an improved response if requested.",
    tone: "text-destructive",
    surface: "bg-destructive/5",
  },
  needs_review: {
    icon: AlertTriangle,
    title: "Waiting for manager review",
    detail: "Automated processing is complete and your submission now needs a manager decision.",
    tone: "text-amber-700",
    surface: "bg-amber-50",
  },
  late_submitted: {
    icon: CheckCircle2,
    title: "Late submission recorded",
    detail: "Your response was submitted after the due time and has been recorded successfully.",
    tone: "text-amber-700",
    surface: "bg-amber-50",
  },
  missed: {
    icon: AlertTriangle,
    title: "Submission window missed",
    detail: "This task closed before a valid submission was completed.",
    tone: "text-destructive",
    surface: "bg-destructive/5",
  },
}

function getJourneySteps(submission: Submission): Array<{ title: string; detail: string; state: StepState }> {
  const uploadedDetail = `${formatRelative(submission.created_at)} · ${formatBytes(submission.size_bytes)}`

  switch (submission.status) {
    case "queued":
      return [
        { title: "Uploaded", detail: uploadedDetail, state: "done" },
        { title: "Queued for processing", detail: "Your file is waiting for the pipeline to start.", state: "current" },
        { title: "Result ready", detail: "A final outcome will appear here once processing is complete.", state: "upcoming" },
      ]
    case "parsing":
      return [
        { title: "Uploaded", detail: uploadedDetail, state: "done" },
        { title: "Extracting document text", detail: "We are reading the file contents now.", state: "current" },
        { title: "Result ready", detail: "Your status will update once processing finishes.", state: "upcoming" },
      ]
    case "validating":
      return [
        { title: "Uploaded", detail: uploadedDetail, state: "done" },
        { title: "Review in progress", detail: "Automated checks are currently running.", state: "current" },
        { title: "Result ready", detail: "Return shortly to see the final outcome.", state: "upcoming" },
      ]
    case "passed":
      return [
        { title: "Uploaded", detail: uploadedDetail, state: "done" },
        { title: "Processing complete", detail: "Your file has been fully reviewed.", state: "done" },
        { title: "Passed", detail: "No further action is needed right now.", state: "current" },
      ]
    case "failed":
      return [
        { title: "Uploaded", detail: uploadedDetail, state: "done" },
        { title: "Processing complete", detail: "The review finished and found issues that may need changes.", state: "done" },
        { title: "Review your task", detail: "Open the task and prepare an updated response if requested.", state: "current" },
      ]
    case "needs_review":
      return [
        { title: "Uploaded", detail: uploadedDetail, state: "done" },
        { title: "Processing complete", detail: "Automated checks have finished.", state: "done" },
        { title: "Manager review pending", detail: "Your manager needs to review the submission outcome.", state: "current" },
      ]
    case "late_submitted":
      return [
        { title: "Uploaded", detail: uploadedDetail, state: "done" },
        { title: "Recorded as late", detail: "The submission was accepted after the due time.", state: "done" },
        { title: "Await outcome", detail: "Your final result will continue to update here.", state: "current" },
      ]
    case "missed":
      return [
        { title: "Task deadline reached", detail: "The submission window closed before completion.", state: "done" },
        { title: "Submission closed", detail: "New uploads are no longer accepted for this task.", state: "current" },
        { title: "Check task details", detail: "Open the task to review the deadline context.", state: "upcoming" },
      ]
  }
}

function nextActionMessage(submission: Submission): string {
  switch (submission.status) {
    case "queued":
    case "parsing":
    case "validating":
      return "You can leave this page and come back later. The status will update as processing moves forward."
    case "passed":
      return "Keep this page as your record of submission, or return to your tasks for the next assignment."
    case "failed":
      return "Open the related task, review the brief again, and be ready to submit an improved version if your manager asks for one."
    case "needs_review":
      return "No action is required yet. Wait for your manager to review the submission outcome."
    case "late_submitted":
      return "Your response has been recorded. Keep an eye on this page for the final outcome."
    case "missed":
      return "Use the task page to review the deadline and any instructions from your manager."
  }
}

function stepTone(state: StepState) {
  if (state === "done") {
    return {
      dot: "border-green-200 bg-green-50 text-green-600",
      line: "bg-green-200",
      title: "text-foreground",
      detail: "text-muted-foreground",
    }
  }
  if (state === "current") {
    return {
      dot: "border-primary/20 bg-[#f2f9ff] text-primary",
      line: "bg-border",
      title: "text-foreground",
      detail: "text-muted-foreground",
    }
  }
  return {
    dot: "border-border bg-background text-muted-foreground",
    line: "bg-border",
    title: "text-muted-foreground",
    detail: "text-muted-foreground",
  }
}

export function MemberSubmissionJourney({
  submission,
  uploaderLabel,
  canRetry,
  canDelete,
  taskTitle,
  taskDueAt,
}: MemberSubmissionJourneyProps) {
  const meta = STATUS_META[submission.status] ?? STATUS_META.queued
  const Icon = meta.icon
  const steps = getJourneySteps(submission)

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 lg:space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-warm-white text-[11px] font-semibold tracking-wide">
            {fileIconLabel(submission.mime_type)}
          </span>
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold tracking-tight text-pretty">
              {submission.title}
            </h1>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              {uploaderLabel} · {formatBytes(submission.size_bytes)} · uploaded {formatRelative(submission.created_at)}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={submission.status} />
              {submission.is_late ? (
                <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold leading-none text-amber-700 whitespace-nowrap">
                  Submitted late
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <SubmissionActions id={submission.id} canRetry={canRetry} canDelete={canDelete} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,360px)] lg:gap-6">
        <div className="space-y-4 lg:space-y-6 min-w-0">
          <section className={cn("rounded-xl border border-border p-5 shadow-card", meta.surface)}>
            <div className="flex items-start gap-3">
              <span className={cn("mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl bg-background/80", meta.tone)}>
                <Icon className={cn("h-5 w-5", (submission.status === "parsing" || submission.status === "validating") && "animate-spin")} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Submission status
                </p>
                <h2 className={cn("mt-1 text-[20px] font-semibold tracking-tight", meta.tone)}>
                  {meta.title}
                </h2>
                <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground">
                  {meta.detail}
                </p>
              </div>
            </div>
            {submission.is_late ? (
              <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
                <p className="text-[12px] font-semibold text-amber-900">Late submission note</p>
                <p className="mt-1 text-[12.5px] text-amber-900/90">
                  {submission.late_reason ?? "This submission was recorded after the task due time."}
                </p>
              </div>
            ) : null}
          </section>

          <section className="rounded-xl border border-border bg-card p-5 shadow-card">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f2f9ff] text-[#097fe8]">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-[15px] font-semibold tracking-tight">What happens next</h2>
                <p className="text-[12px] text-muted-foreground">
                  Follow the progress of your submission from upload to final outcome.
                </p>
              </div>
            </div>
            <ol className="mt-4 space-y-4">
              {steps.map((step, index) => {
                const tone = stepTone(step.state)
                return (
                  <li key={`${step.title}-${index}`} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className={cn("flex h-8 w-8 items-center justify-center rounded-full border text-[12px] font-semibold", tone.dot)}>
                        {index + 1}
                      </span>
                      {index < steps.length - 1 ? <span className={cn("mt-1 h-full w-px", tone.line)} aria-hidden="true" /> : null}
                    </div>
                    <div className="min-w-0 pb-4">
                      <p className={cn("text-[13.5px] font-semibold", tone.title)}>{step.title}</p>
                      <p className={cn("mt-1 text-[12.5px] leading-relaxed", tone.detail)}>{step.detail}</p>
                    </div>
                  </li>
                )
              })}
            </ol>
            <div className="rounded-xl border border-border bg-warm-white px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                Next action
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-foreground">
                {nextActionMessage(submission)}
              </p>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5 shadow-card">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-warm-white text-muted-foreground">
                <FileText className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-[15px] font-semibold tracking-tight">About this submission</h2>
                <p className="text-[12px] text-muted-foreground">
                  A quick summary of the file you uploaded and when it was received.
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-warm-white px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Uploaded by</p>
                <p className="mt-1 text-[13px] font-semibold text-foreground">{uploaderLabel}</p>
              </div>
              <div className="rounded-xl border border-border bg-warm-white px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Received</p>
                <p className="mt-1 text-[13px] font-semibold text-foreground">{formatRelative(submission.created_at)}</p>
              </div>
              <div className="rounded-xl border border-border bg-warm-white px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">File type</p>
                <p className="mt-1 text-[13px] font-semibold text-foreground">{fileIconLabel(submission.mime_type)}</p>
              </div>
              <div className="rounded-xl border border-border bg-warm-white px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">File size</p>
                <p className="mt-1 text-[13px] font-semibold text-foreground">{formatBytes(submission.size_bytes)}</p>
              </div>
            </div>
          </section>
        </div>

        <aside className="space-y-4 lg:space-y-6 min-w-0">
          <section className="rounded-xl border border-border bg-card p-5 shadow-card">
            <h2 className="text-[15px] font-semibold tracking-tight">File</h2>
            <dl className="mt-3 space-y-2 text-[13px]">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Type</dt>
                <dd className="font-medium">{fileIconLabel(submission.mime_type)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Size</dt>
                <dd className="font-medium">{formatBytes(submission.size_bytes)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Uploaded</dt>
                <dd className="font-medium">{formatRelative(submission.created_at)}</dd>
              </div>
            </dl>
            <a
              href={`/api/download/${submission.id}?type=submission`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 h-9 text-[13px] font-semibold hover:bg-muted"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              Open original
            </a>
          </section>

          {submission.task_id ? (
            <section className="rounded-xl border border-border bg-card p-5 shadow-card">
              <h2 className="text-[15px] font-semibold tracking-tight">Task</h2>
              <p className="mt-2 text-[13px] text-muted-foreground">
                {taskTitle ?? "Submitted in response to a task brief."}
              </p>
              {taskDueAt ? (
                <div className="mt-3 rounded-xl border border-border bg-warm-white px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Deadline</p>
                  <p className="mt-1 text-[12.5px] font-medium text-foreground">{formatDeadline(taskDueAt)}</p>
                </div>
              ) : null}
              <Link
                href={`/dashboard/tasks/${submission.task_id}`}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 h-9 text-[13px] font-semibold hover:bg-muted"
              >
                Open task
              </Link>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  )
}
