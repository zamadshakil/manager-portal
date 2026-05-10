import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCanonicalSiteUrl } from "@/lib/site-url"

export const dynamic = "force-dynamic"

function djb2(str: string): string {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i)
  }
  return (hash >>> 0).toString(16)
}

const ERROR_EVENT_TYPES = new Set(["js_error", "unhandled_rejection", "console_error", "console_warn"])
const SESSION_EVENT_TYPES = new Set(["session_start", "heartbeat", "logout"])

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    const origin = request.headers.get("origin")
    if (origin) {
      const allowed = getCanonicalSiteUrl()
      if (origin !== allowed) {
        return NextResponse.json({ ok: false }, { status: 403 })
      }
    }
  }

  try {
    const body = await request.json()
    const { events, session_id, user_id, user_email, user_role } = body as {
      events: Array<{
        type: string
        message?: string
        stack?: string
        source_url?: string
        pathname?: string
        status_code?: number
        duration_ms?: number
        method?: string
        url?: string
        request_headers?: Record<string, string>
        request_body_preview?: string
        response_headers?: Record<string, string>
        response_preview?: string
        metadata?: Record<string, unknown>
      }>
      session_id?: string
      user_id?: string
      user_email?: string
      user_role?: string
    }

    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ ok: true })
    }

    const admin = createAdminClient()
    const ua = request.headers.get("user-agent") ?? undefined
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      ?? request.headers.get("x-real-ip")
      ?? undefined

    const errorInserts: Record<string, unknown>[] = []
    const requestInserts: Record<string, unknown>[] = []
    const pageViewInserts: Record<string, unknown>[] = []
    const sessionInserts: Record<string, unknown>[] = []

    for (const ev of events.slice(0, 60)) {
      if (!ev.type) continue

      // ── Page views ───────────────────────────────────────────────────────
      if (ev.type === "page_view") {
        pageViewInserts.push({
          user_id: user_id || null,
          user_email: user_email || null,
          session_id: session_id || null,
          pathname: (ev.pathname || ev.source_url || "").slice(0, 500),
          user_agent: ua,
        })
        continue
      }

      // ── Session events (session_start / heartbeat / logout) ──────────────
      if (SESSION_EVENT_TYPES.has(ev.type)) {
        sessionInserts.push({
          user_id: user_id || null,
          user_email: user_email || null,
          user_role: user_role || null,
          session_id: session_id || crypto.randomUUID(),
          event_type: ev.type,
          ip_address: ip || null,
          user_agent: ua,
          metadata: ev.metadata || {},
        })
        continue
      }

      // ── JS / console errors ──────────────────────────────────────────────
      if (ERROR_EVENT_TYPES.has(ev.type)) {
        const msg = (ev.message || "Unknown client error").slice(0, 1000)
        const severity = ev.type === "console_warn" ? "warning" : "error"
        errorInserts.push({
          severity,
          source: "client",
          error_message: msg,
          stack_trace: ev.stack?.slice(0, 3000) || null,
          path: ev.pathname?.slice(0, 500) || null,
          user_id: user_id || null,
          fingerprint: djb2(`${ev.type}:${msg.slice(0, 120)}`),
          context: {
            source_url: ev.source_url,
            session_id,
            user_email,
            user_role,
            event_type: ev.type,
            ...(ev.metadata || {}),
          },
        })
        continue
      }

      // ── Network errors (with full diagnostic detail) ─────────────────────
      if (ev.type === "network_error") {
        requestInserts.push({
          method: (ev.method || "GET").toUpperCase().slice(0, 10),
          path: (ev.url || ev.pathname || "unknown").slice(0, 500),
          status_code: typeof ev.status_code === "number" ? ev.status_code : null,
          duration_ms: typeof ev.duration_ms === "number" ? ev.duration_ms : null,
          user_id: user_id || null,
          user_agent: ua,
          error_message: ev.message?.slice(0, 500) || null,
          metadata: {
            source: "client_fetch",
            session_id,
            user_email,
            user_role,
            pathname: ev.pathname,
            request_headers: ev.request_headers || {},
            request_body_preview: ev.request_body_preview || null,
            response_headers: ev.response_headers || {},
            response_preview: ev.response_preview || null,
            ...(ev.metadata || {}),
          },
        })
        continue
      }
    }

    await Promise.all([
      errorInserts.length > 0
        ? (admin.from("system_error_logs") as any).insert(errorInserts)
        : Promise.resolve(),
      requestInserts.length > 0
        ? (admin.from("system_request_logs") as any).insert(requestInserts)
        : Promise.resolve(),
      pageViewInserts.length > 0
        ? (admin as any).from("system_page_views").insert(pageViewInserts)
        : Promise.resolve(),
      sessionInserts.length > 0
        ? (admin as any).from("system_user_sessions").insert(sessionInserts)
        : Promise.resolve(),
    ])

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    console.error("[ops-collector] ingest error:", err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
