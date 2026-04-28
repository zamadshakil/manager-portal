"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, RefreshCw, Trash2 } from "lucide-react"
import { retrySubmission, deleteSubmission } from "@/app/actions/submissions"

interface Props {
  id: string
  canRetry: boolean
  canDelete: boolean
}

export function SubmissionActions({ id, canRetry, canDelete }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function onRetry() {
    const fd = new FormData()
    fd.set("id", id)
    startTransition(async () => {
      const r = await retrySubmission(fd)
      if (!r.ok) alert(r.error ?? "Retry failed.")
      router.refresh()
    })
  }
  function onDelete() {
    if (!confirm("Delete this submission permanently?")) return
    const fd = new FormData()
    fd.set("id", id)
    startTransition(async () => {
      const r = await deleteSubmission(fd)
      if (!r.ok) {
        alert(r.error ?? "Delete failed.")
        return
      }
      router.push("/dashboard/submissions")
    })
  }

  return (
    <div className="flex items-center gap-2">
      {canRetry ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 h-9 text-[13px] font-semibold hover:bg-muted disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Re-run validation
        </button>
      ) : null}
      {canDelete ? (
        <button
          type="button"
          onClick={onDelete}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 h-9 text-[13px] font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          Delete
        </button>
      ) : null}
    </div>
  )
}
