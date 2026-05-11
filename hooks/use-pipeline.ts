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

// Exponential-backoff schedule (ms). The pipeline finishes in ~30-60s so the
// first few polls catch the bulk of state transitions; later polls slow down
// to spare the rate limiter when something is stuck.
const POLL_SCHEDULE_MS = [2_000, 3_000, 5_000, 8_000, 10_000]

// Hard ceiling — if we're still polling 5 min after starting, the pipeline is
// definitively stuck and the cron will mark it failed shortly. The user can
// always reload to resume polling on the new state.
const POLL_CEILING_MS = 5 * 60_000

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
      clearTimeout(pollingRef.current)
      pollingRef.current = null
    }
  }, [])

  const poll = useCallback(
    async (id: string): Promise<{ done: boolean }> => {
      try {
        const res = await fetch(`/api/pipeline/${id}`, { cache: "no-store" })
        if (!res.ok) return { done: false }
        const data = await res.json()
        setStatus(data.status as PipelineStatus)
        setScore(data.score ?? null)

        if (data.terminal) {
          if (refreshOnComplete) router.refresh()
          return { done: true }
        }
      } catch {
        // Network blip — keep polling, it'll recover.
      }
      return { done: false }
    },
    [refreshOnComplete, router],
  )

  const startPolling = useCallback(
    (id: string) => {
      stopPolling()
      const startedAt = Date.now()
      let attempt = 0

      const schedule = (delay: number) => {
        pollingRef.current = setTimeout(async () => {
          // Bail if we've been polling longer than the ceiling — the cron
          // will pick the row up shortly. The user can refresh to resume.
          if (Date.now() - startedAt > POLL_CEILING_MS) {
            stopPolling()
            return
          }
          const { done } = await poll(id)
          if (done) {
            stopPolling()
            return
          }
          // Move to the next interval, capped at the final entry.
          attempt = Math.min(attempt + 1, POLL_SCHEDULE_MS.length - 1)
          schedule(POLL_SCHEDULE_MS[attempt])
        }, delay) as unknown as ReturnType<typeof setInterval>
      }

      // Initial poll with a short delay to give the pipeline a head start.
      schedule(1_500)
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
