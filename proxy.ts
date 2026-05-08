import { type NextRequest, NextResponse } from "next/server"
import { updateSession } from "@/lib/supabase/proxy"

export async function proxy(request: NextRequest) {
  const traceId = crypto.randomUUID().replace(/-/g, "")

  const response = (await updateSession(request)) ?? NextResponse.next()

  response.headers.set("x-trace-id", traceId)
  response.headers.set("x-pathname", request.nextUrl.pathname)

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
