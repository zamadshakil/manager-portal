import { cache } from "react"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import type { Profile, UserRole } from "@/lib/types"

/**
 * Single source of truth for "who is calling me?" in server components and
 * server actions. Wrapped in React.cache so that the layout + page (+ any
 * other server component down the tree) all share ONE round-trip per render
 * pass instead of each repeating the auth.getUser() + profile select.
 *
 * Before: layout calls requireProfile() → auth.getUser() + profile select.
 *         Page calls requireProfile() → auth.getUser() + profile select.
 *         (3+ Supabase round-trips per navigation, all sequential.)
 *
 * After:  the cached function runs once, every subsequent caller in the same
 *         request gets the resolved value for free.
 */
const getCurrentUserAndProfile = cache(async (): Promise<{
  user: Awaited<ReturnType<Awaited<ReturnType<typeof createClient>>["auth"]["getUser"]>>["data"]["user"]
  profile: Profile | null
}> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { user: null, profile: null }

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle()
  return { user, profile: (data as Profile | null) ?? null }
})

export async function getSessionUser() {
  return (await getCurrentUserAndProfile()).user
}

export async function getCurrentProfile(): Promise<Profile | null> {
  return (await getCurrentUserAndProfile()).profile
}

export async function requireProfile(): Promise<Profile> {
  const profile = await getCurrentProfile()
  if (!profile) redirect("/auth/login")
  return profile
}

export async function requireRole(roles: UserRole[]): Promise<Profile> {
  const profile = await requireProfile()
  if (!roles.includes(profile.role)) redirect("/dashboard")
  return profile
}

export function canManageTeam(profile: Profile, teamId: string | null): boolean {
  if (profile.role === "main_admin") return true
  if (profile.role === "manager" && teamId && profile.team_id === teamId) return true
  return false
}

// `roleLabel` lives in `lib/auth-shared.ts` so client components can import
// it without pulling in `server-only` deps. Re-import from there if you need
// it on the server too — do NOT redefine it here.
