"use client"

import { useEffect } from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[dashboard] segment error", error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-border bg-card p-6 shadow-card text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </div>
        <h1 className="mt-3 text-[18px] font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          An unexpected error occurred while loading this view. Try again, and if it keeps
          happening, contact your administrator.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-[11px] text-muted-foreground">id: {error.digest}</p>
        ) : null}
        <div className="mt-5 flex justify-center">
          <Button onClick={reset} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Try again
          </Button>
        </div>
      </div>
    </div>
  )
}
