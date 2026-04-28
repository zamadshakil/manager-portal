import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

const PUBLIC_PATHS = ["/auth", "/_next", "/favicon", "/api/auth"]
const PASSWORD_RESET_PATH = "/dashboard/settings"

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

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
          supabaseResponse = NextResponse.next({ request })
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

  // Force first-time password reset before any other dashboard route is
  // reachable. The settings page detects ?reset=1 and renders a focused
  // password change panel.
  if (user && !isPublic && pathname !== PASSWORD_RESET_PATH) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("must_reset")
      .eq("id", user.id)
      .maybeSingle()
    if (profile?.must_reset) {
      const url = request.nextUrl.clone()
      url.pathname = PASSWORD_RESET_PATH
      url.searchParams.set("reset", "1")
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}
