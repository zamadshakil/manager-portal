import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

function djb2(str: string): string {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i)
  }
  return (hash >>> 0).toString(16)
}

const ERROR_SOURCES = new Set(["js_error", "unhandled_rejection", "console_error", "console_warn"])
const NETWORK_SOURCE = "network_error"
const PAGE_VIEW = "page_view"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { events, session_id, user_id, user_email } = body as {
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
        metadata?: Record<string, unknown>
      }>
      session_id?: string
      user_id?: string
      user_email?: string
    }

    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ ok: true })
    }

    const admin = createAdminClient()
    const ua = request.headers.get("user-agent") ?? undefined

    const errorInserts: Record<string, unknown>[] = []
    const requestInserts: Record<string, unknown>[] = []
    const pageViewInserts: Record<string, unknown>[] = []

    for (const ev of events.slice(0, 50)) {
      if (!ev.type) continue

      if (ev.type === PAGE_VIEW) {
        pageViewInserts.push({
          user_id: user_id || null,
          user_email: user_email || null,
          session_id: session_id || null,
          pathname: (ev.pathname || ev.source_url || "").slice(0, 500),
          referrer: null,
          user_agent: ua,
        })
        continue
      }

      if (ERROR_SOURCES.has(ev.type)) {
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
            event_type: ev.type,
          },
        })
        continue
      }

      if (ev.type === NETWORK_SOURCE) {
        requestInserts.push({
          method: (ev.method || "GET").toUpperCase().slice(0, 10),
          path: (ev.url || ev.pathname || "unknown").slice(0, 500),
          status_code: typeof ev.status_code === "number" ? ev.status_code : null,
          duration_ms: typeof ev.duration_ms === "number" ? ev.duration_ms : null,
          user_id: user_id || null,
          user_agent: ua,
          error_message: ev.message?.slice(0, 500) || null,
          metadata: { session_id, source: "client_fetch", pathname: ev.pathname },
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
    ])

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    console.error("[ops-collector] ingest error:", err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
