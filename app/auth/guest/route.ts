import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getCanonicalSiteUrl } from "@/lib/site-url"

type GuestPersona = "manager" | "member"

function sanitizeNext(raw: FormDataEntryValue | null): string {
  if (typeof raw !== "string") return "/dashboard"
  if (/^\/[a-zA-Z0-9_\-/.?=&#%]*$/.test(raw) && !raw.startsWith("//")) return raw
  return "/dashboard"
}

function guestCredentials(persona: GuestPersona) {
  const prefix = persona === "manager" ? "SHOWCASE_GUEST_MANAGER" : "SHOWCASE_GUEST_MEMBER"
  return {
    email: process.env[`${prefix}_EMAIL`]?.trim(),
    password: process.env[`${prefix}_PASSWORD`],
  }
}

export async function POST(request: Request) {
  const origin = getCanonicalSiteUrl()
  const requestOrigin = request.headers.get("origin")
  if (requestOrigin && requestOrigin !== origin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (process.env.SHOWCASE_GUEST_LOGIN_ENABLED !== "true") {
    return NextResponse.redirect(`${origin}/auth/login?guest=disabled`, 303)
  }

  const form = await request.formData()
  const rawPersona = form.get("persona")
  const persona: GuestPersona | null =
    rawPersona === "manager" || rawPersona === "member" ? rawPersona : null
  const next = sanitizeNext(form.get("next"))
  if (!persona) {
    return NextResponse.redirect(`${origin}/auth/login?guest=error`, 303)
  }

  const { email, password } = guestCredentials(persona)
  if (!email || !password) {
    console.error(`[guest-login] Missing credentials for ${persona} showcase account`)
    return NextResponse.redirect(`${origin}/auth/login?guest=unavailable`, 303)
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      console.error(`[guest-login] ${persona} sign-in failed:`, error.message)
      return NextResponse.redirect(`${origin}/auth/login?guest=error`, 303)
    }
    return NextResponse.redirect(`${origin}${next}`, 303)
  } catch (error) {
    console.error(`[guest-login] ${persona} sign-in failed:`, error)
    return NextResponse.redirect(`${origin}/auth/login?guest=error`, 303)
  }
}
