import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

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

  return NextResponse.redirect(new URL(user ? next : `/auth/login?next=${encodeURIComponent(next)}`, request.url))
}
