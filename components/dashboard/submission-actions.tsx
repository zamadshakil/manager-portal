"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, RefreshCw, Trash2, CheckCircle2, Clock } from "lucide-react"
import { retrySubmission, deleteSubmission } from "@/app/actions/submissions"
import { usePipeline } from "@/hooks/use-pipeline"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"

interface Props {
  id: string
  canRetry: boolean
  canDelete: boolean
}

export function SubmissionActions({ id, canRetry, canDelete }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [retryError, setRetryError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const pipeline = usePipeline({ refreshOnComplete: true })

  function onRetry() {
    setRetryError(null)
    const fd = new FormData()
    fd.set("id", id)
    startTransition(async () => {
      const r = await retrySubmission(fd)
      if (!r.ok) {
        setRetryError(r.error ?? "Retry failed.")
        return
      }
      // Server action reset status to "queued" — now trigger the pipeline.
      if (r.submissionId) {
        pipeline.trigger(r.submissionId)
      }
      router.refresh()
    })
  }

  function onConfirmDelete() {
    setDeleteError(null)
    const fd = new FormData()
    fd.set("id", id)
    startTransition(async () => {
      const r = await deleteSubmission(fd)
      if (!r.ok) {
        setDeleteError(r.error ?? "Delete failed.")
        return
      }
      router.push("/dashboard/submissions")
    })
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {/* Pipeline progress indicator (shown during retry) */}
      {pipeline.isRunning && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-[#f2f9ff] px-3 py-2 text-[12.5px] font-medium text-primary">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          <span>
            {pipeline.status === "queued"
              ? "Re-queued…"
              : pipeline.status === "parsing"
                ? "Parsing document…"
                : "Validating…"}
          </span>
        </div>
      )}

      {pipeline.status === "passed" && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-[12.5px] font-medium text-green-700">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          Validation complete
        </div>
      )}

      <div className="flex items-center gap-2">
        {canRetry ? (
          <button
            type="button"
            onClick={onRetry}
            disabled={pending || pipeline.isRunning}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 h-9 text-[13px] font-semibold hover:bg-muted disabled:opacity-50"
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : pipeline.isRunning ? (
              <Clock className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Re-run validation
          </button>
        ) : null}
        {canDelete ? (
          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 h-9 text-[13px] font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Delete
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this submission?</AlertDialogTitle>
                <AlertDialogDescription>
                  The file and all validation results will be permanently removed. This action
                  cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              {deleteError ? (
                <p role="alert" className="text-[12.5px] font-semibold text-destructive">
                  {deleteError}
                </p>
              ) : null}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={pending}
                  onClick={(e) => {
                    e.preventDefault()
                    onConfirmDelete()
                  }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {pending ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" aria-hidden="true" />
                      Deleting…
                    </>
                  ) : (
                    "Delete"
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>
      {retryError ? (
        <p role="alert" className="text-[12px] font-semibold text-destructive">
          {retryError}
        </p>
      ) : null}
    </div>
  )
}
