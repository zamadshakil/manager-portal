import { type NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/proxy"

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  // Skip middleware for:
  //  - Next.js internals and static asset extensions
  //  - Cron endpoints (`/api/cron/*`) — they authenticate via shared secret,
  //    not via Supabase session cookies, so refreshing the session on every
  //    invocation is wasted IO.
  matcher: [
    "/((?!api/cron|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
}
