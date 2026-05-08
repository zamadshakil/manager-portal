import { type NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/proxy"

/**
 * Next.js Edge Middleware — runs before every matched request.
 *
 * Delegates to updateSession() in lib/supabase/proxy.ts which:
 *  1. Refreshes the Supabase session cookie so server components always
 *     see a valid, non-expired token (prevents stale-JWT sign-out issues).
 *  2. Redirects unauthenticated requests to /auth/login.
 *
 * NOTE: The legacy proxy.ts at the project root exported the same config
 * but under the name `proxy` — Next.js only recognises `middleware.ts` with
 * a `middleware` export, so that file was silently never executed.
 */
export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  // Skip middleware for:
  //  - Cron endpoints (/api/cron/*) — authenticated via shared secret, not session cookies.
  //  - Next.js internals and static assets.
  matcher: [
    "/((?!api/cron|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
}
