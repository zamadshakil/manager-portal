"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireProfile } from "@/lib/auth"
import { logActivity } from "@/lib/activity"

const ProfileSchema = z.object({
  full_name: z.string().trim().min(1).max(200),
})

export async function updateProfile(formData: FormData) {
  const profile = await requireProfile()
  const parsed = ProfileSchema.safeParse({ full_name: formData.get("full_name") })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }

  const supabase = await createClient()
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data.full_name })
    .eq("id", profile.id)
  if (error) return { ok: false, error: error.message }

  await logActivity({
    actorId: profile.id,
    teamId: profile.team_id,
    action: "profile.updated",
    entityType: "profile",
    entityId: profile.id,
  })

  revalidatePath("/dashboard/settings")
  return { ok: true }
}

const PasswordSchema = z
  .object({
    new_password: z.string().min(8).max(72),
    confirm_password: z.string().min(8).max(72),
  })
  .refine((v) => v.new_password === v.confirm_password, {
    message: "Passwords do not match",
    path: ["confirm_password"],
  })

export async function updatePassword(formData: FormData) {
  const profile = await requireProfile()
  const parsed = PasswordSchema.safeParse({
    new_password: formData.get("new_password") || "",
    confirm_password: formData.get("confirm_password") || "",
  })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }

  // Use the service-role admin client to update the password by user id.
  // Going through the SSR session client can silently no-op against the
  // self-hosted GoTrue when the session cookie can't be refreshed inside a
  // server action, which leaves the *old* password still valid at sign-in.
  // Updating by id guarantees the change is persisted in auth.users.
  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(profile.id, {
    password: parsed.data.new_password,
  })
  if (error) return { ok: false, error: error.message }

  // Revoke all existing refresh tokens for this user so any other devices
  // / stale sessions can no longer mint new access tokens with the old
  // credentials. The current browser will be signed out as well and must
  // re-authenticate with the new password.
  try {
    await admin.auth.admin.signOut(profile.id)
  } catch (e) {
    console.warn("[updatePassword] failed to revoke sessions:", e)
  }

  // Clear must_reset flag.
  if (profile.must_reset) {
    await admin.from("profiles").update({ must_reset: false }).eq("id", profile.id)
  }

  // Also clear the local Supabase auth cookies so this tab is signed out
  // immediately and the user is forced to log in again with the new password.
  try {
    const supabase = await createClient()
    await supabase.auth.signOut()
  } catch (e) {
    console.warn("[updatePassword] local signOut failed:", e)
  }

  await logActivity({
    actorId: profile.id,
    teamId: profile.team_id,
    action: "password.changed",
    entityType: "profile",
    entityId: profile.id,
  })

  revalidatePath("/dashboard/settings")
  return { ok: true }
}
