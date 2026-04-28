"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Trash2, Loader2 } from "lucide-react"

interface Props {
  id: string
  action: (formData: FormData) => Promise<{ ok: boolean; error?: string }>
  confirmText?: string
  label: string
}

export function DeleteIconButton({ id, action, confirmText, label }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()

  function onClick() {
    if (confirmText && !confirm(confirmText)) return
    const fd = new FormData()
    fd.set("id", id)
    start(async () => {
      const res = await action(fd)
      if (!res.ok) {
        alert(res.error ?? "Could not delete.")
        return
      }
      router.refresh()
    })
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label={label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:opacity-50"
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
      )}
    </button>
  )
}
