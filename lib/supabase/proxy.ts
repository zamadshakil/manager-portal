import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { getSupabaseEnv, warnIfSupabaseUnconfigured } from "@/lib/env"

const PUBLIC_PATHS = ["/auth", "/_next", "/favicon", "/api/auth", "/api/cron"]

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
  const traceId = request.headers.get("x-trace-id") ?? crypto.randomUUID().replace(/-/g, "")
  // Expose the current pathname to server components — Next does not
  // surface it natively in layouts/pages, and we need it for the
  // must-reset gate in the dashboard layout.
  requestHeaders.set("x-trace-id", traceId)
  requestHeaders.set("x-pathname", request.nextUrl.pathname)

  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  })
  supabaseResponse.headers.set("x-trace-id", traceId)
  supabaseResponse.headers.set("x-pathname", request.nextUrl.pathname)

  // After the Railway migration, env vars on the new project may be empty
  // for a few minutes (key rotation, kong DNS warm-up, etc.). Crashing
  // here turns every request into a 500 — including /auth/login — which
  // makes recovery impossible. Instead, fail-open: pass the request
  // through with a clear server-side warning and let route handlers /
  // server components render their own "Supabase not configured" state.
  const env = getSupabaseEnv()
  if (!env.configured) {
    warnIfSupabaseUnconfigured("proxy.updateSession")
    return supabaseResponse
  }

  // Detect whether the request already carries a Supabase auth cookie. If
  // it does and getUser() still returns null, that means refresh-token
  // rotation failed (e.g. the proxy consumed the token but the new value
  // never made it back to the browser). We log that case explicitly so
  // unexpected sign-outs are traceable in Railway logs.
  const hadAuthCookie = request.cookies
    .getAll()
    .some((c) => /^sb-.*-auth-token(\.|$)/.test(c.name))

  const supabase = createServerClient(
    env.url,
    env.anonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Mutate the *incoming* request cookies so downstream RSC/route
          // handlers in this same request see the freshly rotated session.
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set({ name, value, ...options }),
          )
          // Rebuild the outgoing response forwarding the mutated request
          // (NOT a frozen header snapshot). This is the official
          // `@supabase/ssr` pattern; using `{ headers: requestHeaders }`
          // here was the cause of intermittent redirects to /auth/login
          // during the refresh-token rotation window.
          supabaseResponse = NextResponse.next({ request })
          supabaseResponse.headers.set("x-trace-id", traceId)
          supabaseResponse.headers.set("x-pathname", request.nextUrl.pathname)
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
    if (hadAuthCookie) {
      console.warn(
        `[proxy] auth cookie present but getUser() returned null trace=${traceId} path=${pathname}`,
      )
    }
    const url = request.nextUrl.clone()
    url.pathname = hadAuthCookie ? "/auth/session-recovery" : "/auth/login"
    url.searchParams.set("next", pathname)
    const redirectResponse = NextResponse.redirect(url)
    redirectResponse.headers.set("x-trace-id", traceId)
    redirectResponse.headers.set("x-pathname", request.nextUrl.pathname)
    for (const cookie of supabaseResponse.cookies.getAll()) {
      redirectResponse.cookies.set(cookie)
    }
    return redirectResponse
  }

  return supabaseResponse
}
