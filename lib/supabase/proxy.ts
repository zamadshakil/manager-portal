import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

const PUBLIC_PATHS = ["/auth", "/_next", "/favicon", "/api/auth", "/api/inngest"]

/**
 * Edge proxy run for every (non-static) request. Two responsibilities:
 *
 *  1. Refresh the Supabase session cookie so server components down the
 *     stack always see a valid token. This is a single auth API call —
 *     unavoidable for token rotation.
 *
 *  2. Bounce unauthenticated users to /auth/login.
 *
 * The "must reset password" enforcement used to live here too, which meant
 * an EXTRA round-trip to Postgres on every navigation, RSC fetch, and API
 * call. That check has been moved into the dashboard layout (cached via
 * React.cache so layout + page share a single profile select). The proxy
 * now just forwards `x-pathname` so the layout can decide whether to
 * redirect to the password-reset settings page.
 */
export async function updateSession(request: NextRequest) {
  const requestHeaders = new Headers(request.headers)
  // Expose the current pathname to server components — Next does not
  // surface it natively in layouts/pages, and we need it for the
  // must-reset gate in the dashboard layout.
  requestHeaders.set("x-pathname", request.nextUrl.pathname)

  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request: { headers: requestHeaders },
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p))

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = "/auth/login"
    url.searchParams.set("next", pathname)
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
