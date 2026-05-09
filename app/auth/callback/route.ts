import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getConfiguredSiteUrl } from "@/lib/site-url"

function sanitizeNext(raw: string | null): string {
  if (!raw) return "/dashboard"
  // C-4: Only allow relative paths — block external URLs and protocol-relative redirects
  if (/^\/[a-zA-Z0-9_\-/.?=&#%]*$/.test(raw) && !raw.startsWith("//")) return raw
  return "/dashboard"
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get("code")
  const type = searchParams.get("type")
  const next = sanitizeNext(searchParams.get("next"))

  // M-7 / C-3: Always use the pinned canonical origin — never derive from
  // x-forwarded-host which can be spoofed by an attacker.
  const origin = getConfiguredSiteUrl()

  if (!origin) {
    console.error("[callback] NEXT_PUBLIC_SITE_URL is not set — cannot build a safe redirect.")
    return NextResponse.redirect(new URL(request.url).origin + "/auth/error")
  }

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // If the callback is from a password recovery email, redirect to
      // the update-password page instead of the default dashboard.
      if (type === "recovery") {
        return NextResponse.redirect(`${origin}/auth/update-password`)
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/auth/error`)
}
