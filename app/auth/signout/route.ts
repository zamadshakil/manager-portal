import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  // H-7: CSRF protection — reject cross-site POST requests.
  // Next.js Route Handlers do not get automatic CSRF protection (unlike Server Actions).
  const canonicalOrigin = process.env.NEXT_PUBLIC_SITE_URL
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
  await supabase.auth.signOut()

  // M-7 / C-3: Always redirect to the pinned canonical origin — never derive
  // from x-forwarded-host to prevent host-header injection on logout.
  const origin =
    canonicalOrigin ||
    (process.env.NODE_ENV === "development"
      ? `${new URL(request.url).protocol}//${new URL(request.url).host}`
      : new URL(request.url).origin)

  return NextResponse.redirect(`${origin}/auth/login`, { status: 303 })
}
