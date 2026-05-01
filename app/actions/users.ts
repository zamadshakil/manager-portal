"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireRole } from "@/lib/auth"
import { logActivity } from "@/lib/activity"

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

  await logActivity({
    actorId: actor.id,
    teamId: parsed.data.team_id || null,
    action: "user.provisioned",
    entityType: "profile",
    entityId: data.user.id,
    metadata: { email: parsed.data.email, role: parsed.data.role },
  })

  revalidatePath("/dashboard/team")
  revalidatePath("/dashboard/admin/users")
  return { ok: true }
}
