"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

export type PipelineStatus =
  | "idle"
  | "queued"
  | "parsing"
  | "validating"
  | "passed"
  | "failed"
  | "needs_review"
  | "late_submitted"

const TERMINAL_STATUSES = new Set([
  "passed",
  "failed",
  "needs_review",
  "late_submitted",
  "missed",
])

const POLL_INTERVAL_MS = 3_000

interface UsePipelineOpts {
  /** Auto-refresh the page via router.refresh() when the pipeline reaches a terminal state. */
  refreshOnComplete?: boolean
}

/**
 * Client-side hook that triggers the AI validation pipeline for a submission
 * and polls for status updates until a terminal state is reached.
 *
 * Usage:
 * ```tsx
 * const { trigger, status, score, isRunning } = usePipeline()
 * // After upload:
 * trigger(submissionId)
 * ```
 */
export function usePipeline(opts: UsePipelineOpts = {}) {
  const { refreshOnComplete = true } = opts
  const router = useRouter()
  const [status, setStatus] = useState<PipelineStatus>("idle")
  const [score, setScore] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const submissionIdRef = useRef<string | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }, [])

  const poll = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/pipeline/${id}`, { cache: "no-store" })
        if (!res.ok) return
        const data = await res.json()
        setStatus(data.status as PipelineStatus)
        setScore(data.score ?? null)

        if (data.terminal) {
          stopPolling()
          if (refreshOnComplete) {
            router.refresh()
          }
        }
      } catch {
        // Network blip — keep polling, it'll recover.
      }
    },
    [stopPolling, refreshOnComplete, router],
  )

  const startPolling = useCallback(
    (id: string) => {
      stopPolling()
      // Immediate first poll after a short delay to give the pipeline time to start.
      const timeout = setTimeout(() => {
        poll(id)
        pollingRef.current = setInterval(() => poll(id), POLL_INTERVAL_MS)
      }, 1_500)
      // Store the timeout handle so cleanup can clear it.
      pollingRef.current = timeout as unknown as ReturnType<typeof setInterval>
    },
    [poll, stopPolling],
  )

  /**
   * Trigger the pipeline for a submission. Fires a POST to `/api/pipeline/[id]`
   * (fire-and-forget — the route runs up to 60s) and starts polling for status.
   */
  const trigger = useCallback(
    (submissionId: string) => {
      submissionIdRef.current = submissionId
      setStatus("queued")
      setScore(null)
      setError(null)

      // Fire-and-forget: trigger the pipeline route.
      const controller = new AbortController()
      abortRef.current = controller
      fetch(`/api/pipeline/${submissionId}`, {
        method: "POST",
        signal: controller.signal,
      }).catch(() => {
        // The POST may "fail" from the client's perspective if the browser
        // closes the connection before the 60s pipeline completes. That's fine —
        // the server-side pipeline continues running to completion.
      })

      // Start polling for status updates independently.
      startPolling(submissionId)
    },
    [startPolling],
  )

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      stopPolling()
      abortRef.current?.abort()
    }
  }, [stopPolling])

  return {
    trigger,
    status,
    score,
    error,
    isRunning: !TERMINAL_STATUSES.has(status) && status !== "idle",
  }
}
