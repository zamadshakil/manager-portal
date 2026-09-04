import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getCanonicalSiteUrl } from "@/lib/site-url"
import { verifyToken } from "@/lib/ops/auth"

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

const SAFE_METADATA_KEYS = new Set([
  "lineno",
  "colno",
  "screen",
  "timezone",
  "language",
  "fetch_threw",
])

function safeMetadata(value: Record<string, unknown> | undefined) {
  if (!value) return {}
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, item]) => SAFE_METADATA_KEYS.has(key) && ["string", "number", "boolean"].includes(typeof item))
      .map(([key, item]) => [key, typeof item === "string" ? item.slice(0, 200) : item]),
  )
}

function safeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const parsed = new URL(value, getCanonicalSiteUrl())
    return `${parsed.origin}${parsed.pathname}`.slice(0, 500)
  } catch {
    return value.split(/[?#]/, 1)[0]?.slice(0, 500)
  }
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || "0")
  if (contentLength > 256_000) {
    return NextResponse.json({ ok: false }, { status: 413 })
  }

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
    let verifiedUser: { id: string | null; email: string | null; role: string | null } | null = null
    const jar = await cookies()
    const opsToken = jar.get("ops_session")?.value
    const opsPayload = opsToken ? verifyToken(opsToken) : null

    if (opsPayload) {
      verifiedUser = { id: null, email: opsPayload.sub, role: "ops_admin" }
    } else {
      try {
        const supabase = await createClient()
        const { data } = await supabase.auth.getUser()
        if (data.user) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("email, role")
            .eq("id", data.user.id)
            .maybeSingle()
          verifiedUser = {
            id: data.user.id,
            email: profile?.email ?? data.user.email ?? null,
            role: profile?.role ?? null,
          }
        }
      } catch {
        // Missing or invalid Supabase sessions are handled by the 401 below.
      }
    }

    if (!verifiedUser) {
      return NextResponse.json({ ok: false }, { status: 401 })
    }

    const body = await request.json()
    const { events, session_id } = body as {
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
          user_id: verifiedUser.id,
          user_email: verifiedUser.email,
          session_id: session_id || null,
          pathname: (ev.pathname || safeUrl(ev.source_url) || "").slice(0, 500),
          user_agent: ua,
        })
        continue
      }

      // ── Session events (session_start / heartbeat / logout) ──────────────
      if (SESSION_EVENT_TYPES.has(ev.type)) {
        sessionInserts.push({
          user_id: verifiedUser.id,
          user_email: verifiedUser.email,
          user_role: verifiedUser.role,
          session_id: session_id || crypto.randomUUID(),
          event_type: ev.type,
          ip_address: ip || null,
          user_agent: ua,
          metadata: safeMetadata(ev.metadata),
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
          user_id: verifiedUser.id,
          fingerprint: djb2(`${ev.type}:${msg.slice(0, 120)}`),
          context: {
            source_url: safeUrl(ev.source_url),
            session_id,
            user_email: verifiedUser.email,
            user_role: verifiedUser.role,
            event_type: ev.type,
            ...safeMetadata(ev.metadata),
          },
        })
        continue
      }

      // ── Network errors (status and timing only) ──────────────────────────
      if (ev.type === "network_error") {
        requestInserts.push({
          method: (ev.method || "GET").toUpperCase().slice(0, 10),
          path: (safeUrl(ev.url) || ev.pathname || "unknown").slice(0, 500),
          status_code: typeof ev.status_code === "number" ? ev.status_code : null,
          duration_ms: typeof ev.duration_ms === "number" ? ev.duration_ms : null,
          user_id: verifiedUser.id,
          user_agent: ua,
          error_message: ev.message?.slice(0, 500) || null,
          metadata: {
            source: "client_fetch",
            session_id,
            user_email: verifiedUser.email,
            user_role: verifiedUser.role,
            pathname: ev.pathname,
            ...safeMetadata(ev.metadata),
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
