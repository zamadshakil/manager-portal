"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"

interface OpsCollectorProps {
  userId?: string
  userEmail?: string
}

interface CollectorEvent {
  type: "page_view" | "js_error" | "unhandled_rejection" | "console_error" | "console_warn" | "network_error"
  message?: string
  stack?: string
  source_url?: string
  pathname?: string
  status_code?: number
  duration_ms?: number
  method?: string
  url?: string
  metadata?: Record<string, unknown>
}

const BATCH_INTERVAL_MS = 4000
const MAX_BATCH_SIZE = 20
const INGEST_URL = "/api/ops/ingest"

export function OpsCollector({ userId, userEmail }: OpsCollectorProps) {
  const pathname = usePathname()
  const sessionId = useRef<string>(
    typeof sessionStorage !== "undefined"
      ? (() => {
          let s = sessionStorage.getItem("ops_sid")
          if (!s) { s = crypto.randomUUID(); sessionStorage.setItem("ops_sid", s) }
          return s
        })()
      : crypto.randomUUID()
  )
  const queue = useRef<CollectorEvent[]>([])
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pageEnteredAt = useRef<number>(Date.now())

  function enqueue(event: CollectorEvent) {
    queue.current.push(event)
    if (queue.current.length >= MAX_BATCH_SIZE) flush()
    else if (!flushTimer.current) {
      flushTimer.current = setTimeout(flush, BATCH_INTERVAL_MS)
    }
  }

  function flush() {
    if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null }
    if (queue.current.length === 0) return
    const batch = queue.current.splice(0, MAX_BATCH_SIZE)
    navigator.sendBeacon?.(
      INGEST_URL,
      JSON.stringify({ events: batch, session_id: sessionId.current, user_id: userId, user_email: userEmail })
    ) ?? fetch(INGEST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: batch, session_id: sessionId.current, user_id: userId, user_email: userEmail }),
      keepalive: true,
    }).catch(() => {})
  }

  useEffect(() => {
    enqueue({ type: "page_view", pathname, source_url: location.href })
    pageEnteredAt.current = Date.now()
  }, [pathname])

  useEffect(() => {
    function onError(event: ErrorEvent) {
      enqueue({
        type: "js_error",
        message: event.message || "Unknown error",
        stack: event.error?.stack,
        source_url: event.filename,
        pathname: location.pathname,
      })
    }

    function onUnhandledRejection(event: PromiseRejectionEvent) {
      const reason = event.reason
      enqueue({
        type: "unhandled_rejection",
        message: reason?.message || String(reason) || "Unhandled promise rejection",
        stack: reason?.stack,
        pathname: location.pathname,
      })
    }

    const originalError = console.error.bind(console)
    const originalWarn = console.warn.bind(console)

    console.error = (...args: unknown[]) => {
      originalError(...args)
      const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")
      if (!msg.includes("[ops-collector]")) {
        enqueue({ type: "console_error", message: msg.slice(0, 500), pathname: location.pathname })
      }
    }

    console.warn = (...args: unknown[]) => {
      originalWarn(...args)
      const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")
      enqueue({ type: "console_warn", message: msg.slice(0, 500), pathname: location.pathname })
    }

    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      const method = init?.method || "GET"
      if (url.includes(INGEST_URL)) return originalFetch(input, init)
      const t = Date.now()
      try {
        const res = await originalFetch(input, init)
        const duration_ms = Date.now() - t
        if (!res.ok && res.status >= 400) {
          enqueue({ type: "network_error", url: url.slice(0, 300), method, status_code: res.status, duration_ms, pathname: location.pathname })
        }
        return res
      } catch (err: unknown) {
        enqueue({ type: "network_error", url: url.slice(0, 300), method, status_code: 0, duration_ms: Date.now() - t, message: (err as Error)?.message, pathname: location.pathname })
        throw err
      }
    }

    window.addEventListener("error", onError)
    window.addEventListener("unhandledrejection", onUnhandledRejection)
    window.addEventListener("beforeunload", flush)

    return () => {
      window.removeEventListener("error", onError)
      window.removeEventListener("unhandledrejection", onUnhandledRejection)
      window.removeEventListener("beforeunload", flush)
      console.error = originalError
      console.warn = originalWarn
      window.fetch = originalFetch
      flush()
    }
  }, [userId, userEmail])

  return null
}
