"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireRole } from "@/lib/auth"
import { logActivity } from "@/lib/activity"
import { sendWelcomeEmail } from "@/lib/email"

const Schema = z
  .object({
    email: z.string().email(),
    full_name: z.string().trim().min(1).max(200),
    role: z.enum(["main_admin", "manager", "member"]),
    team_id: z.string().uuid().optional().or(z.literal("")),
    password: z.string().min(8).max(72),
  })
  .superRefine((value, ctx) => {
    // Managers must own a team — without one they cannot create tasks,
    // assign members, or own validation rules. Enforce at the boundary so
    // the UI surfaces a clear validation message instead of a silent state.
    if (value.role === "manager" && !value.team_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["team_id"],
        message: "A team is required when provisioning a manager.",
      })
    }
  })

export async function provisionUser(formData: FormData) {
  const actor = await requireRole(["main_admin"])
  const parsed = Schema.safeParse({
    email: formData.get("email") || "",
    full_name: formData.get("full_name") || "",
    role: formData.get("role") || undefined,
    team_id: formData.get("team_id") ?? "",
    password: formData.get("password") || "",
  })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }

  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: {
      full_name: parsed.data.full_name,
      role: parsed.data.role,
      team_id: parsed.data.team_id || null,
      must_reset: true,
    },
  })
  if (error || !data.user) return { ok: false, error: error?.message ?? "Could not create user." }

  // The on_auth_user_created trigger inserts the profile row; ensure team
  // assignment is consistent (the trigger reads metadata, but team_id may have
  // been blank if metadata cast failed — safe re-update via service role).
  if (parsed.data.team_id) {
    await admin
      .from("profiles")
      .update({ team_id: parsed.data.team_id, role: parsed.data.role })
      .eq("id", data.user.id)
  }

  // Auto-provision a default AI credit row for the new user.
  // main_admin accounts are always unlimited; others start at 100 msgs/month.
  try {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)
    await admin.from("ai_credit_limits").upsert(
      {
        user_id: data.user.id,
        monthly_limit: 100,
        used_this_period: 0,
        period_type: "monthly",
        period_start: monthStart,
        period_end: monthEnd,
        is_unlimited: parsed.data.role === "main_admin",
        updated_by: actor.id,
      },
      { onConflict: "user_id" },
    )
  } catch (creditErr: any) {
    // Non-blocking — credit row can be set later from the AI & Usage page
    console.warn("[provisionUser] could not create credit row:", creditErr.message)
  }

  await logActivity({
    actorId: actor.id,
    teamId: parsed.data.team_id || null,
    action: "user.provisioned",
    entityType: "profile",
    entityId: data.user.id,
    metadata: { email: parsed.data.email, role: parsed.data.role },
  })

  // Send the welcome email with their credentials.
  // We await this to ensure Next.js does not abort the background fetch.
  await sendWelcomeEmail({
    email: parsed.data.email,
    fullName: parsed.data.full_name,
    role: parsed.data.role || "member",
    password: parsed.data.password,
  }).catch((err) => {
    console.error("[provisionUser] Failed to send welcome email:", err)
  })

  revalidatePath("/dashboard/team")
  revalidatePath("/dashboard/admin/users")
  return { ok: true }
}

/**
 * Delete a user account. Only main_admin can do this.
 * Handles multiple scenarios:
 *  - Normal user (exists in auth + profiles): deletes from auth, then cleans up profile
 *  - Orphaned profile (exists in profiles but not auth): deletes profile directly
 *  - Logs the action to the audit trail
 */
export async function deleteUser(userId: string): Promise<{ ok: boolean; error?: string }> {
  const actor = await requireRole(["main_admin"])

  if (!userId || typeof userId !== "string") {
    return { ok: false, error: "Invalid user ID." }
  }

  // Prevent self-deletion
  if (userId === actor.id) {
    return { ok: false, error: "You cannot delete your own account." }
  }

  const admin = createAdminClient()

  // Fetch the target profile for logging — use maybeSingle() to avoid
  // throwing when the profile row is missing or has a query error.
  const { data: targetProfile, error: profileError } = await admin
    .from("profiles")
    .select("email, full_name, role")
    .eq("id", userId)
    .maybeSingle()

  if (profileError) {
    console.error("[deleteUser] profile lookup error:", profileError.message)
  }

  // Try to delete from Supabase Auth first (this cascades if FK is set up).
  // If the user only exists in profiles (orphan row), this will fail — that's OK.
  const { error: authError } = await admin.auth.admin.deleteUser(userId)
  if (authError) {
    console.warn("[deleteUser] auth delete failed (may be orphan profile):", authError.message)
  }

  // Always try to delete the profile row directly — handles orphaned rows
  // and cases where the FK cascade didn't fire.
  const { error: deleteProfileError } = await admin
    .from("profiles")
    .delete()
    .eq("id", userId)

  if (deleteProfileError) {
    console.error("[deleteUser] profile delete error:", deleteProfileError.message)
  }

  // If both auth and profile deletes failed, the user truly can't be removed
  if (authError && deleteProfileError) {
    return {
      ok: false,
      error: `Could not delete user: ${deleteProfileError.message}`,
    }
  }

  await logActivity({
    actorId: actor.id,
    teamId: null,
    action: "user.deleted",
    entityType: "profile",
    entityId: userId,
    metadata: {
      email: targetProfile?.email ?? "unknown",
      full_name: targetProfile?.full_name ?? "unknown",
      role: targetProfile?.role ?? "unknown",
    },
  })

  revalidatePath("/dashboard/team")
  revalidatePath("/dashboard/admin/users")
  return { ok: true }
}
