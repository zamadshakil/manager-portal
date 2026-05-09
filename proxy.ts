import { type NextRequest, NextResponse } from "next/server"
import { updateSession } from "@/lib/supabase/proxy"
import { verifyToken } from "@/lib/ops/auth"

export async function proxy(request: NextRequest) {
  const traceId = crypto.randomUUID().replace(/-/g, "")
  const { pathname } = request.nextUrl

  // /ops route protection (previously handled by middleware.ts)
  if (
    pathname.startsWith("/ops") &&
    pathname !== "/ops/login" &&
    !pathname.startsWith("/ops/login/")
  ) {
    const token = request.cookies.get("ops_session")?.value
    if (!token) {
      const loginUrl = new URL("/ops/login", request.url)
      loginUrl.searchParams.set("from", pathname)
      return NextResponse.redirect(loginUrl)
    }
    const payload = verifyToken(token)
    if (!payload) {
      const loginUrl = new URL("/ops/login", request.url)
      loginUrl.searchParams.set("from", pathname)
      const response = NextResponse.redirect(loginUrl)
      response.cookies.delete("ops_session")
      return response
    }
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
