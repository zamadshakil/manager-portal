import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import type { Profile, UserRole } from "@/lib/types"

export async function getSessionUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single()
  return (data as Profile | null) ?? null
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

export function roleLabel(role: UserRole): string {
  switch (role) {
    case "main_admin":
      return "Main Admin"
    case "manager":
      return "Manager"
    case "member":
      return "Team Member"
  }
}
