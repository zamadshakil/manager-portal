"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { getTaskDeadlineTransitionTimestamps, type TaskDeadlineInput } from "@/lib/task-deadlines"

interface TaskDeadlineWatchItem extends TaskDeadlineInput {
  id: string
}

/**
 * Returns the current millisecond timestamp, updating every second so
 * deadline-phase UI stays live. Also triggers `router.refresh()` the first
 * time a task crosses a deadline boundary so the server-rendered state
 * catches up.
 *
 * IMPORTANT: `initialNow` must be provided by Server Components that host
 * this hook inside an SSR'd Client Component. If the hook is allowed to
 * default to its own `Date.now()` on both passes, the server and client
 * will see different values → `getTaskDeadlineWindow(...)` can return
 * different phases → conditional subtrees mismatch → React throws
 * hydration error #418. Passing a single `Date.now()` computed in the
 * server render and serialized through the RSC payload makes the first
 * render deterministic; the `setInterval` below then ticks the real time
 * forward after mount.
 */
export function useTaskDeadlineNow(
  items: TaskDeadlineWatchItem[],
  initialNow?: number,
): number {
  const router = useRouter()
  const [now, setNow] = useState(() => initialNow ?? Date.now())
  const handledTransitionKeysRef = useRef<Set<string> | null>(null)

  const transitionKeys = useMemo(() => {
    const keys: string[] = []

    for (const item of items) {
      const timestamps = getTaskDeadlineTransitionTimestamps(item)
      for (const timestamp of timestamps) {
        if (now >= timestamp) {
          keys.push(`${item.id}:${timestamp}`)
        }
      }
    }

    return keys.sort()
  }, [items, now])

  const hasTimedItems = useMemo(
    () => items.some((item) => getTaskDeadlineTransitionTimestamps(item).length > 0),
    [items],
  )

  useEffect(() => {
    if (!hasTimedItems) return

    const interval = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(interval)
    }
  }, [hasTimedItems])

  useEffect(() => {
    if (handledTransitionKeysRef.current === null) {
      handledTransitionKeysRef.current = new Set(transitionKeys)
      return
    }

    let shouldRefresh = false
    for (const key of transitionKeys) {
      if (!handledTransitionKeysRef.current.has(key)) {
        handledTransitionKeysRef.current.add(key)
        shouldRefresh = true
      }
    }

    if (shouldRefresh) {
      router.refresh()
    }
  }, [router, transitionKeys])

  return now
}
