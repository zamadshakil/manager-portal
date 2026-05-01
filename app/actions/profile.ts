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

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password: parsed.data.new_password })
  if (error) return { ok: false, error: error.message }

  // Clear must_reset flag.
  if (profile.must_reset) {
    const admin = createAdminClient()
    await admin.from("profiles").update({ must_reset: false }).eq("id", profile.id)
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
