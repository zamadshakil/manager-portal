"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"

interface OpsCollectorProps {
  userId?: string
  userEmail?: string
  userRole?: string
}

interface CollectorEvent {
  type:
    | "page_view"
    | "js_error"
    | "unhandled_rejection"
    | "console_error"
    | "console_warn"
    | "network_error"
    | "session_start"
    | "heartbeat"
    | "logout"
  message?: string
  stack?: string
  source_url?: string
  pathname?: string
  status_code?: number
  duration_ms?: number
  method?: string
  url?: string
  // Rich network diagnostics
  request_headers?: Record<string, string>
  request_body_preview?: string
  response_headers?: Record<string, string>
  response_preview?: string
  metadata?: Record<string, unknown>
}

const BATCH_INTERVAL_MS = 3000
const MAX_BATCH_SIZE = 20
const HEARTBEAT_INTERVAL_MS = 15 * 1000 // 15 seconds
const INGEST_URL = "/api/ops/ingest"

function getSessionId(): string {
  try {
    let s = sessionStorage.getItem("ops_sid")
    if (!s) { s = crypto.randomUUID(); sessionStorage.setItem("ops_sid", s) }
    return s
  } catch {
    return crypto.randomUUID()
  }
}

function headersToObject(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    new Headers(headers ?? {}).forEach((v, k) => {
      // Skip auth tokens from being captured
      if (!["authorization", "cookie", "set-cookie"].includes(k.toLowerCase())) {
        out[k] = v
      }
    })
  } catch { /* noop */ }
  return out
}

function responseHeadersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    headers.forEach((v, k) => {
      if (!["set-cookie"].includes(k.toLowerCase())) out[k] = v
    })
  } catch { /* noop */ }
  return out
}

export function OpsCollector({ userId, userEmail, userRole }: OpsCollectorProps) {
  const pathname = usePathname()
  const sessionId = useRef<string>(getSessionId())
  const queue = useRef<CollectorEvent[]>([])
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const initialized = useRef(false)

  // ── flush ────────────────────────────────────────────────────────────────
  function flush() {
    if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null }
    if (queue.current.length === 0) return
    const batch = queue.current.splice(0, MAX_BATCH_SIZE)
    const payload = JSON.stringify({
      events: batch,
      session_id: sessionId.current,
      user_id: userId,
      user_email: userEmail,
      user_role: userRole,
    })
    const blob = new Blob([payload], { type: "application/json" })
    const sent = typeof navigator !== "undefined" && navigator.sendBeacon?.(INGEST_URL, blob)
    if (!sent) {
      fetch(INGEST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {})
    }
  }

  function enqueue(event: CollectorEvent) {
    queue.current.push(event)
    if (queue.current.length >= MAX_BATCH_SIZE) flush()
    else if (!flushTimer.current) {
      flushTimer.current = setTimeout(flush, BATCH_INTERVAL_MS)
    }
  }

  // ── page view tracking ───────────────────────────────────────────────────
  useEffect(() => {
    enqueue({ type: "page_view", pathname, source_url: location.href })
  }, [pathname])

  // ── core setup: session, heartbeat, error listeners, fetch patch ─────────
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    // Session start
    enqueue({
      type: "session_start",
      pathname: location.pathname,
      metadata: {
        user_agent: navigator.userAgent,
        screen: `${screen.width}x${screen.height}`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: navigator.language,
      },
    })

    // Heartbeat — keeps "online" status alive
    heartbeatTimer.current = setInterval(() => {
      enqueue({ type: "heartbeat", pathname: location.pathname })
    }, HEARTBEAT_INTERVAL_MS)

    // JS errors
    function onError(ev: ErrorEvent) {
      enqueue({
        type: "js_error",
        message: ev.message || "Unknown JS error",
        stack: ev.error?.stack?.slice(0, 3000),
        source_url: ev.filename,
        pathname: location.pathname,
        metadata: { lineno: ev.lineno, colno: ev.colno },
      })
    }

    // Unhandled promise rejections
    function onRejection(ev: PromiseRejectionEvent) {
      const r = ev.reason
      enqueue({
        type: "unhandled_rejection",
        message: r?.message || String(r) || "Unhandled rejection",
        stack: r?.stack?.slice(0, 3000),
        pathname: location.pathname,
      })
    }

    // Console patching
    const origError = console.error.bind(console)
    const origWarn = console.warn.bind(console)
    console.error = (...args: unknown[]) => {
      origError(...args)
      const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")
      if (!msg.includes("[ops-collector]")) {
        enqueue({ type: "console_error", message: msg.slice(0, 600), pathname: location.pathname })
      }
    }
    console.warn = (...args: unknown[]) => {
      origWarn(...args)
      const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")
      if (!msg.includes("[ops-collector]")) {
        enqueue({ type: "console_warn", message: msg.slice(0, 600), pathname: location.pathname })
      }
    }

    // Fetch patching — captures rich diagnostics on every failed request
    const origFetch = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input
        : input instanceof URL ? input.href
        : (input as Request).url
      if (url.includes(INGEST_URL)) return origFetch(input, init)

      const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase()
      const reqHeaders = headersToObject(init?.headers ?? (input instanceof Request ? input.headers : undefined))
      let reqBodyPreview: string | undefined
      try {
        if (init?.body && typeof init.body === "string") {
          reqBodyPreview = init.body.slice(0, 400)
        }
      } catch { /* noop */ }

      const t = Date.now()
      try {
        const res = await origFetch(input, init)
        const duration_ms = Date.now() - t
        if (!res.ok && res.status >= 400) {
          const resHeaders = responseHeadersToObject(res.headers)
          let resPreview: string | undefined
          try { resPreview = await res.clone().text().then((t) => t.slice(0, 800)) } catch { /* noop */ }
          enqueue({
            type: "network_error",
            url: url.slice(0, 400),
            method,
            status_code: res.status,
            duration_ms,
            pathname: location.pathname,
            request_headers: reqHeaders,
            request_body_preview: reqBodyPreview,
            response_headers: resHeaders,
            response_preview: resPreview,
          })
        }
        return res
      } catch (err: unknown) {
        enqueue({
          type: "network_error",
          url: url.slice(0, 400),
          method,
          status_code: 0,
          duration_ms: Date.now() - t,
          message: (err as Error)?.message,
          pathname: location.pathname,
          request_headers: reqHeaders,
          request_body_preview: reqBodyPreview,
          metadata: { fetch_threw: true },
        })
        throw err
      }
    }

    // Logout detection via beforeunload
    function onUnload() {
      enqueue({ type: "logout", pathname: location.pathname })
      flush()
    }

    window.addEventListener("error", onError)
    window.addEventListener("unhandledrejection", onRejection)
    window.addEventListener("beforeunload", onUnload)

    return () => {
      window.removeEventListener("error", onError)
      window.removeEventListener("unhandledrejection", onRejection)
      window.removeEventListener("beforeunload", onUnload)
      console.error = origError
      console.warn = origWarn
      window.fetch = origFetch
      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current)
      flush()
    }
  }, [userId, userEmail, userRole])

  return null
}
