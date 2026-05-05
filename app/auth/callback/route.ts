import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get("code")
  const type = searchParams.get("type")
  const next = searchParams.get("next") ?? "/dashboard"

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host")
  const proto = request.headers.get("x-forwarded-proto") || "https"

  let origin = new URL(request.url).origin
  if (siteUrl) {
    origin = siteUrl
  } else if (host) {
    origin = `${proto}://${host}`
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
