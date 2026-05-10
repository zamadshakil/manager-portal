import { type NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/proxy"

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Supabase session refresh + auth guard (must run first)
  const response = await updateSession(request)

  // Fire-and-forget: log dashboard page navigations so the monitor shows
  // activity even when users are just browsing (no API action needed).
  if (pathname.startsWith("/dashboard")) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (supabaseUrl && serviceKey) {
      const ip =
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        request.headers.get("x-real-ip") ??
        null
      const ua = request.headers.get("user-agent") ?? null

      fetch(`${supabaseUrl}/rest/v1/system_request_logs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          method: request.method,
          path: pathname,
          status_code: 200,
          duration_ms: 0,
          ip_address: ip,
          user_agent: ua,
          metadata: { source: "page_navigation" },
        }),
      }).catch(() => {})
    }
  }

  return response
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
