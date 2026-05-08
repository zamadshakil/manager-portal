"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { createAdminClient } from "@/lib/supabase/admin"
import { requireProfile } from "@/lib/auth"
import {
  AccessDeniedError,
  CAPABILITIES,
  assertCapability,
  type PermissionDefinitionRow,
  type RoleDefaultRow,
  type UserOverrideRow,
} from "@/lib/permissions"
import { logActivity } from "@/lib/activity"

// =============================================================================
// Permission management server actions
// =============================================================================
//
// Only users with the `user_management.permissions` capability (main_admin by
// default) can grant or revoke per-user overrides. Every change is recorded
// in the activity log so the audit trail is preserved.
// =============================================================================

const SetOverrideSchema = z.object({
  user_id: z.string().uuid(),
  capability_key: z.string().min(1),
  effect: z.enum(["allow", "deny", "clear"]),
  reason: z.string().max(500).optional().or(z.literal("")),
})

async function requirePermissionAdmin() {
  const profile = await requireProfile()
  await assertCapability(profile, CAPABILITIES.USER_MANAGEMENT_PERMISSIONS)
  return profile
}

/**
 * Set / clear a per-user capability override. Pass `effect: 'clear'` to
 * remove an existing override and fall back to the role default.
 */
export async function setUserPermissionOverride(input: z.infer<typeof SetOverrideSchema>) {
  let profile
  try {
    profile = await requirePermissionAdmin()
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      return { ok: false, error: "You do not have permission to manage user permissions." }
    }
    throw err
  }

  const parsed = SetOverrideSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  // Disallow clobbering main_admin's permissions through overrides — the
  // resolver shortcuts main_admin to allow-everything, so accidental rows
  // would be confusing and useless.
  const admin = createAdminClient()
  const { data: target } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", parsed.data.user_id)
    .maybeSingle()

  if (!target) return { ok: false, error: "User not found." }
  if ((target as any).role === "main_admin") {
    return { ok: false, error: "Main admin permissions cannot be overridden." }
  }

  // Validate capability exists.
  const { data: capRow } = await admin
    .from("permission_definitions")
    .select("key, is_admin_only")
    .eq("key", parsed.data.capability_key)
    .maybeSingle()
  if (!capRow) return { ok: false, error: "Unknown capability." }

  // Safety net: capabilities marked `is_admin_only` cannot be granted to
  // managers / members via override. Removing the override is still allowed.
  if (
    parsed.data.effect === "allow" &&
    (capRow as any).is_admin_only === true
  ) {
    return {
      ok: false,
      error: "This capability is reserved for the main admin and cannot be granted via override.",
    }
  }

  if (parsed.data.effect === "clear") {
    const { error } = await admin
      .from("user_permission_overrides")
      .delete()
      .eq("user_id", parsed.data.user_id)
      .eq("capability_key", parsed.data.capability_key)
    if (error) return { ok: false, error: error.message }

    await logActivity({
      actorId: profile.id,
      teamId: null,
      action: "permission.override.cleared",
      entityType: "user_permission_override",
      entityId: parsed.data.user_id,
      metadata: {
        target_user_id: parsed.data.user_id,
        capability_key: parsed.data.capability_key,
      },
    })
  } else {
    const { error } = await admin
      .from("user_permission_overrides")
      .upsert(
        {
          user_id: parsed.data.user_id,
          capability_key: parsed.data.capability_key,
          effect: parsed.data.effect,
          granted_by: profile.id,
          reason: parsed.data.reason || null,
        },
        { onConflict: "user_id,capability_key" },
      )
    if (error) return { ok: false, error: error.message }

    await logActivity({
      actorId: profile.id,
      teamId: null,
      action: parsed.data.effect === "allow"
        ? "permission.override.granted"
        : "permission.override.denied",
      entityType: "user_permission_override",
      entityId: parsed.data.user_id,
      metadata: {
        target_user_id: parsed.data.user_id,
        capability_key: parsed.data.capability_key,
        reason: parsed.data.reason || null,
      },
    })
  }

  revalidatePath("/dashboard/permissions")
  return { ok: true }
}

/**
 * Bulk-load everything the admin UI needs: catalog, role defaults, and the
 * full override table. The page is admin-only so the volume is manageable.
 */
export async function loadPermissionAdminData(): Promise<{
  ok: boolean
  error?: string
  definitions?: PermissionDefinitionRow[]
  defaults?: RoleDefaultRow[]
  overrides?: UserOverrideRow[]
}> {
  try {
    await requirePermissionAdmin()
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      return { ok: false, error: "You do not have permission to view this page." }
    }
    throw err
  }

  const admin = createAdminClient()
  const [defs, defaults, overrides] = await Promise.all([
    admin
      .from("permission_definitions")
      .select("key, module, action, description, is_admin_only")
      .order("module")
      .order("action"),
    admin.from("role_permission_defaults").select("role, capability_key"),
    admin
      .from("user_permission_overrides")
      .select("user_id, capability_key, effect, granted_by, reason, updated_at"),
  ])

  if (defs.error) return { ok: false, error: defs.error.message }
  if (defaults.error) return { ok: false, error: defaults.error.message }
  if (overrides.error) return { ok: false, error: overrides.error.message }

  return {
    ok: true,
    definitions: (defs.data ?? []) as PermissionDefinitionRow[],
    defaults: (defaults.data ?? []) as RoleDefaultRow[],
    overrides: (overrides.data ?? []) as UserOverrideRow[],
  }
}
