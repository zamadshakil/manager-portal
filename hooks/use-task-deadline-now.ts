"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { getTaskDeadlineTransitionTimestamps, type TaskDeadlineInput } from "@/lib/task-deadlines"

interface TaskDeadlineWatchItem extends TaskDeadlineInput {
  id: string
}

export function useTaskDeadlineNow(items: TaskDeadlineWatchItem[]): number {
  const router = useRouter()
  const [now, setNow] = useState(() => Date.now())
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
