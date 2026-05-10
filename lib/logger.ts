/**
 * Structured observability logger.
 *
 * Architecture:
 *  - All log entries carry a `trace_id` (W3C-compatible UUID).
 *  - Field names follow OpenTelemetry semantic conventions so the schema
 *    can be forwarded to Grafana/Tempo without field renames later.
 *  - Writes are fire-and-forget (no `await`) so they never block responses.
 *
 * Future migration: replace the Supabase writes here with an
 * OpenTelemetry exporter (OTLP) and remove the DB tables.
 */
import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RequestLogParams {
  traceId?: string | null
  method: string
  path: string
  statusCode: number
  durationMs: number
  userId?: string | null
  ipAddress?: string | null
  userAgent?: string | null
  errorMessage?: string | null
  requestSize?: number | null
  responseSize?: number | null
  metadata?: Record<string, unknown>
}

export interface ErrorLogParams {
  traceId?: string | null
  severity?: "error" | "warning" | "info"
  source?: "api" | "server" | "cron" | "client" | "pipeline" | "ai"
  errorMessage: string
  errorCode?: string | null
  stackTrace?: string | null
  path?: string | null
  method?: string | null
  userId?: string | null
  ipAddress?: string | null
  fingerprint?: string | null
  context?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function generateTraceId(): string {
  return crypto.randomUUID().replace(/-/g, "")
}

/**
 * Deterministic fingerprint for error grouping.
 * Groups identical errors regardless of which user/request triggered them.
 * Strips UUIDs and long numeric IDs so the same error on different resources
 * maps to the same issue group.
 */
function buildFingerprint(
  params: Pick<ErrorLogParams, "errorMessage" | "source" | "path" | "errorCode">,
): string {
  const raw = [
    params.source ?? "server",
    params.errorCode ?? "",
    params.path ?? "",
    (params.errorMessage ?? "")
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, "<uuid>")
      .replace(/\b\d{4,}\b/g, "<id>"),
  ]
    .join("|")
    .toLowerCase()
  // djb2 hash — no crypto overhead, deterministic
  let h = 5381
  for (let i = 0; i < raw.length; i++) h = ((h << 5) + h) ^ raw.charCodeAt(i)
  return (h >>> 0).toString(16).padStart(8, "0")
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Log an API request. Call after the handler resolves, non-blocking.
 * Example:
 *   const start = Date.now()
 *   const res = await handler(req)
 *   logRequest({ method, path, statusCode: res.status, durationMs: Date.now() - start })
 *   return res
 */
export function logRequest(params: RequestLogParams): void {
  try {
    const admin = createAdminClient()
    admin
      .from("system_request_logs")
      .insert({
        trace_id: params.traceId ?? null,
        method: params.method.toUpperCase(),
        path: params.path,
        status_code: params.statusCode,
        duration_ms: params.durationMs,
        user_id: params.userId ?? null,
        ip_address: params.ipAddress ?? null,
        user_agent: params.userAgent ?? null,
        error_message: params.errorMessage ?? null,
        request_size: params.requestSize ?? null,
        response_size: params.responseSize ?? null,
        metadata: (params.metadata ?? {}) as any,
      } as any)
      .then(({ error }) => {
        if (error) console.error("[logger] logRequest failed", error.message)
      })
  } catch (err) {
    console.error("[logger] logRequest init failed", err)
  }
}

/**
 * Log a structured error. Can be called from any server-side context.
 */
export function logError(params: ErrorLogParams): void {
  try {
    const admin = createAdminClient()
    admin
      .from("system_error_logs")
      .insert({
        trace_id: params.traceId ?? null,
        severity: params.severity ?? "error",
        source: params.source ?? "server",
        error_message: params.errorMessage,
        error_code: params.errorCode ?? null,
        stack_trace: params.stackTrace ?? null,
        path: params.path ?? null,
        method: params.method ?? null,
        user_id: params.userId ?? null,
        ip_address: params.ipAddress ?? null,
        fingerprint: params.fingerprint ?? buildFingerprint(params),
        context: (params.context ?? {}) as any,
      } as any)
      .then(({ error }) => {
        if (error) console.error("[logger] logError failed", error.message)
      })
  } catch (err) {
    console.error("[logger] logError init failed", err)
  }
}

/**
 * Convenience: captures both a console.error and a structured DB log.
 * Use this in catch blocks across the app.
 */
export function captureException(
  err: unknown,
  context?: Omit<ErrorLogParams, "errorMessage" | "stackTrace">,
): void {
  const e = err instanceof Error ? err : new Error(String(err))
  console.error("[app]", e.message, context)
  logError({
    ...context,
    errorMessage: e.message,
    stackTrace: e.stack ?? null,
  })
}

// ---------------------------------------------------------------------------
// API Route wrapper HOC
// ---------------------------------------------------------------------------
// Wraps a Next.js route handler to automatically measure latency, log the
// request, and capture any unhandled errors.
//
// Usage in route.ts:
//   export const GET = withRequestLog(async (req) => { ... })

import { type NextRequest, NextResponse } from "next/server"

type RouteHandler = (req: NextRequest, ctx: any) => Promise<Response>

export function withRequestLog(handler: RouteHandler): RouteHandler {
  return async (req: NextRequest, ctx: any) => {
    const start = Date.now()
    const traceId = req.headers.get("x-trace-id") ?? generateTraceId()
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null
    const ua = req.headers.get("user-agent") ?? null

    let status = 500
    let errorMsg: string | null = null

    try {
      const res = await handler(req, ctx)
      status = res.status
      const durationMs = Date.now() - start

      logRequest({
        traceId,
        method: req.method,
        path: new URL(req.url).pathname,
        statusCode: status,
        durationMs,
        ipAddress: ip,
        userAgent: ua,
        errorMessage: status >= 400 ? `HTTP ${status}` : null,
      })

      return res
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      errorMsg = e.message
      const durationMs = Date.now() - start

      logError({
        traceId,
        severity: "error",
        source: "api",
        errorMessage: e.message,
        stackTrace: e.stack ?? null,
        path: new URL(req.url).pathname,
        method: req.method,
        ipAddress: ip,
      })

      logRequest({
        traceId,
        method: req.method,
        path: new URL(req.url).pathname,
        statusCode: 500,
        durationMs,
        ipAddress: ip,
        userAgent: ua,
        errorMessage: errorMsg,
      })

      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  }
}
