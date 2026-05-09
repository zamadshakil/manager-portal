import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getConfiguredSiteUrl } from "@/lib/site-url"

export async function POST(request: Request) {
  // H-7: CSRF protection — reject cross-site POST requests.
  // Next.js Route Handlers do not get automatic CSRF protection (unlike Server Actions).
  // Strip any trailing slash: the browser Origin header never includes one, so a
  // mismatch here would silently return 403 on every sign-out attempt.
  const canonicalOrigin = getConfiguredSiteUrl()
  if (canonicalOrigin) {
    const reqOrigin = request.headers.get("origin")
    const reqReferer = request.headers.get("referer")
    const originOk = !reqOrigin || reqOrigin === canonicalOrigin
    const refererOk = !reqReferer || reqReferer.startsWith(canonicalOrigin + "/")
    if (!originOk && !refererOk) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  const supabase = await createClient()
  // scope:'local' clears session cookies immediately without a blocking HTTP
  // round-trip to the self-hosted GoTrue service on Railway (~300-800 ms saved).
  // The server-side JWT record expires naturally on its own TTL. If hard
  // server-side revocation is ever required, add a fire-and-forget background
  // call here using scope:'global' without await.
  await supabase.auth.signOut({ scope: "local" })

  // M-7 / C-3: Always redirect to the pinned canonical origin — never derive
  // from x-forwarded-host to prevent host-header injection on logout.
  const origin =
    canonicalOrigin ||
    (process.env.NODE_ENV === "development"
      ? `${new URL(request.url).protocol}//${new URL(request.url).host}`
      : new URL(request.url).origin)

  return NextResponse.redirect(`${origin}/auth/login`, { status: 303 })
}
