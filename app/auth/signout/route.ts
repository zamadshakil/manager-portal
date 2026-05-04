import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  const supabase = await createClient()
  await supabase.auth.signOut()

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host")
  const proto = request.headers.get("x-forwarded-proto") || "https"

  let origin = new URL(request.url).origin
  if (siteUrl) {
    origin = siteUrl
  } else if (host) {
    origin = `${proto}://${host}`
  }

  return NextResponse.redirect(`${origin}/auth/login`, { status: 303 })
}
