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
        const forwardedHost = request.headers.get("x-forwarded-host")
        const forwardedProto = request.headers.get("x-forwarded-proto")
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
        let baseUrl = request.url
        if (forwardedHost) {
          const proto = forwardedProto ? forwardedProto.split(",")[0].trim() : "https"
          baseUrl = `${proto}://${forwardedHost.split(",")[0].trim()}`
        } else if (siteUrl) {
          baseUrl = siteUrl
        }
        const loginUrl = new URL("/ops/login", baseUrl)
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
