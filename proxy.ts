import { type NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/proxy"

export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  // Skip the proxy for:
  //  - Next.js internals and static asset extensions
  //  - Cron endpoints (`/api/cron/*`) — they authenticate via shared secret,
  //    not via Supabase session cookies, so refreshing the session on every
  //    invocation is wasted IO on a hot path that runs every 15 min.
  //  - Web Vitals beacons (`/api/vitals`) — sendBeacon fires LCP/CLS/INP/FCP/
  //    TTFB samples after every page load. Refreshing the Supabase session
  //    on each one would multiply auth round-trips per navigation.
  matcher: [
    "/((?!api/cron|api/vitals|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
}
