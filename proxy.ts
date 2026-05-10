import { type NextRequest, NextResponse } from "next/server"
import { updateSession } from "@/lib/supabase/proxy"

export async function proxy(request: NextRequest) {
  const traceId = crypto.randomUUID().replace(/-/g, "")
  const { pathname } = request.nextUrl

  // /ops/* and /api/ops/* are fully independent of Supabase auth.
  // Full JWT verification is done server-side in the layout + API routes
  // (Node runtime). Here we only do a cookie-presence redirect guard so
  // the edge proxy never touches the Supabase session for these paths.
  if (pathname.startsWith("/ops") || pathname.startsWith("/api/ops")) {
    if (
      pathname.startsWith("/ops") &&
      pathname !== "/ops/login" &&
      !pathname.startsWith("/ops/login/")
    ) {
      const hasSession = !!request.cookies.get("ops_session")?.value
      if (!hasSession) {
        const loginUrl = new URL("/ops/login", request.url)
        loginUrl.searchParams.set("from", pathname)
        return NextResponse.redirect(loginUrl)
      }
    }
    const res = NextResponse.next()
    res.headers.set("x-trace-id", traceId)
    res.headers.set("x-pathname", pathname)
    return res
  }

  const response = (await updateSession(request)) ?? NextResponse.next()

  response.headers.set("x-trace-id", traceId)
  response.headers.set("x-pathname", pathname)

  // Fire-and-forget: log dashboard page navigations so the ops monitor
  // shows REQUESTS (24H) even when users are just browsing pages.
  if (pathname.startsWith("/dashboard")) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (supabaseUrl && serviceKey) {
      fetch(`${supabaseUrl}/rest/v1/system_request_logs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          method: request.method,
          path: pathname,
          status_code: 200,
          duration_ms: 0,
          ip_address:
            request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
            request.headers.get("x-real-ip") ??
            null,
          user_agent: request.headers.get("user-agent") ?? null,
          metadata: { source: "page_navigation", trace_id: traceId },
        }),
      }).catch(() => {})
    }
  }

  return response
}

export const config = {
  // Skip proxy for:
  //  - Next.js internals and static asset extensions
  //  - Cron endpoints (`/api/cron/*`) — they authenticate via shared secret,
  //    not via Supabase session cookies, so refreshing the session on every
  //    invocation is wasted IO.
  matcher: [
    "/((?!api/cron|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
}
