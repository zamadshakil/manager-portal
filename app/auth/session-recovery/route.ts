import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getCanonicalSiteUrl } from "@/lib/site-url"

function sanitizeNext(raw: string | null): string {
  if (!raw) return "/dashboard"
  if (/^\/[a-zA-Z0-9_\-/.?=&#%]*$/.test(raw) && !raw.startsWith("//")) return raw
  return "/dashboard"
}

export async function GET(request: Request) {
  const next = sanitizeNext(new URL(request.url).searchParams.get("next"))
  const supabase = await createClient()
  let user = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch (err) {
    console.error("[session-recovery] getUser() threw — redirecting to login", err)
  }

  // Use NEXT_PUBLIC_SITE_URL as base so the internal Railway bind address
  // (0.0.0.0:PORT) never leaks into the redirect. Fall back to request.url
  // only in local dev where NEXT_PUBLIC_SITE_URL is not set.
  const base = getCanonicalSiteUrl()
  const target = user ? next : `/auth/login?next=${encodeURIComponent(next)}`
  return NextResponse.redirect(new URL(target, base))
}
