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
  effect: z.enum(["allow", "clear"]),
  reason: z.string().max(500).optional().or(z.literal("")),
  expires_at: z.string().datetime().optional().nullable(),
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

    await (admin as any)
      .from("permission_override_history")
      .insert({
        user_id: parsed.data.user_id,
        capability: parsed.data.capability_key,
        action: "cleared",
        allow: null,
        expires_at: null,
        granted_by: profile.id,
      })

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
    // effect === 'allow' — the only non-clear case after deny was removed.
    const upsertPayload: Record<string, unknown> = {
      user_id: parsed.data.user_id,
      capability_key: parsed.data.capability_key,
      effect: "allow",
      granted_by: profile.id,
      reason: parsed.data.reason || null,
      expires_at: parsed.data.expires_at ?? null,
    }
    const { error } = await (admin as any)
      .from("user_permission_overrides")
      .upsert(upsertPayload, { onConflict: "user_id,capability_key" })
    if (error) return { ok: false, error: error.message }

    await (admin as any)
      .from("permission_override_history")
      .insert({
        user_id: parsed.data.user_id,
        capability: parsed.data.capability_key,
        action: "set_allow",
        allow: true,
        expires_at: parsed.data.expires_at ?? null,
        granted_by: profile.id,
      })

    await logActivity({
      actorId: profile.id,
      teamId: null,
      action: "permission.override.granted",
      entityType: "user_permission_override",
      entityId: parsed.data.user_id,
      metadata: {
        target_user_id: parsed.data.user_id,
        capability_key: parsed.data.capability_key,
        reason: parsed.data.reason || null,
        expires_at: parsed.data.expires_at ?? null,
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
  const [defs, defaults, overridesRaw] = await Promise.all([
    admin
      .from("permission_definitions")
      .select("key, module, action, description, is_admin_only")
      .order("module")
      .order("action"),
    admin.from("role_permission_defaults").select("role, capability_key"),
    (admin as any)
      .from("user_permission_overrides")
      .select("user_id, capability_key, effect, granted_by, reason, expires_at, updated_at"),
  ])

  if (defs.error) return { ok: false, error: defs.error.message }
  if (defaults.error) return { ok: false, error: defaults.error.message }
  if (overridesRaw.error) return { ok: false, error: overridesRaw.error.message }

  // Enrich overrides with the granter's display name
  const rawRows: any[] = overridesRaw.data ?? []
  const granterIds = [...new Set(rawRows.map((r: any) => r.granted_by).filter(Boolean))]
  let granterMap: Record<string, string> = {}
  if (granterIds.length > 0) {
    const { data: granters } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", granterIds)
    for (const g of granters ?? []) {
      granterMap[g.id] = (g as any).full_name ?? "Unknown"
    }
  }

  const overrides: UserOverrideRow[] = rawRows.map((r: any) => ({
    user_id: r.user_id,
    capability_key: r.capability_key,
    effect: r.effect,
    granted_by: r.granted_by ?? null,
    granted_by_name: r.granted_by ? (granterMap[r.granted_by] ?? null) : null,
    reason: r.reason ?? null,
    expires_at: r.expires_at ?? null,
    updated_at: r.updated_at,
  }))

  return {
    ok: true,
    definitions: (defs.data ?? []) as PermissionDefinitionRow[],
    defaults: (defaults.data ?? []) as RoleDefaultRow[],
    overrides,
  }
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export interface PermissionHistoryEntry {
  id: string
  capability: string
  action: "set_allow" | "set_deny" | "cleared"
  allow: boolean | null
  expires_at: string | null
  granted_by: string | null
  granted_by_name: string | null
  changed_at: string
}

/**
 * Load the full audit history of overrides for a specific user.
 */
export async function loadPermissionHistory(userId: string): Promise<{
  ok: boolean
  error?: string
  history?: PermissionHistoryEntry[]
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
  const { data, error } = await (admin as any)
    .from("permission_override_history")
    .select("id, capability, action, allow, expires_at, granted_by, changed_at")
    .eq("user_id", userId)
    .order("changed_at", { ascending: false })
    .limit(200)

  if (error) return { ok: false, error: error.message }

  const rows: any[] = data ?? []
  const granterIds = [...new Set(rows.map((r: any) => r.granted_by).filter(Boolean))]
  let granterMap: Record<string, string> = {}
  if (granterIds.length > 0) {
    const { data: granters } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", granterIds)
    for (const g of granters ?? []) {
      granterMap[g.id] = (g as any).full_name ?? "Unknown"
    }
  }

  const history: PermissionHistoryEntry[] = rows.map((r: any) => ({
    id: r.id,
    capability: r.capability,
    action: r.action,
    allow: r.allow,
    expires_at: r.expires_at ?? null,
    granted_by: r.granted_by ?? null,
    granted_by_name: r.granted_by ? (granterMap[r.granted_by] ?? null) : null,
    changed_at: r.changed_at,
  }))

  return { ok: true, history }
}

// ---------------------------------------------------------------------------
// Bulk override
// ---------------------------------------------------------------------------

const BulkOverrideSchema = z.object({
  user_ids: z.array(z.string().uuid()).min(1).max(200),
  capability_keys: z.array(z.string().min(1)).min(1).max(50),
  effect: z.enum(["allow", "clear"]),
  reason: z.string().max(500).optional().or(z.literal("")),
  expires_at: z.string().datetime().optional().nullable(),
})

/**
 * Apply the same override effect to multiple users × capabilities in one call.
 * Returns partial failure info if some rows fail.
 */
export async function bulkSetUserPermissionOverrides(
  input: z.infer<typeof BulkOverrideSchema>,
): Promise<{ ok: boolean; error?: string; failed?: string[] }> {
  let profile
  try {
    profile = await requirePermissionAdmin()
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      return { ok: false, error: "You do not have permission to manage user permissions." }
    }
    throw err
  }

  const parsed = BulkOverrideSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const admin = createAdminClient()

  // Guard: none of the targets may be main_admin
  const { data: targets } = await admin
    .from("profiles")
    .select("id, role")
    .in("id", parsed.data.user_ids)
  const adminTargets = (targets ?? []).filter((t: any) => t.role === "main_admin")
  if (adminTargets.length > 0) {
    return { ok: false, error: "Main admin permissions cannot be overridden." }
  }

  // Guard: all capabilities must exist and none are admin-only when granting
  const { data: capRows } = await admin
    .from("permission_definitions")
    .select("key, is_admin_only")
    .in("key", parsed.data.capability_keys)

  const knownKeys = new Set((capRows ?? []).map((c: any) => c.key))
  const unknown = parsed.data.capability_keys.filter((k) => !knownKeys.has(k))
  if (unknown.length > 0) {
    return { ok: false, error: `Unknown capabilities: ${unknown.join(", ")}` }
  }

  if (parsed.data.effect === "allow") {
    const adminOnly = (capRows ?? []).filter((c: any) => c.is_admin_only).map((c: any) => c.key)
    if (adminOnly.length > 0) {
      return { ok: false, error: `Admin-only capabilities cannot be granted: ${adminOnly.join(", ")}` }
    }
  }

  const failed: string[] = []

  if (parsed.data.effect === "clear") {
    for (const userId of parsed.data.user_ids) {
      const { error } = await admin
        .from("user_permission_overrides")
        .delete()
        .eq("user_id", userId)
        .in("capability_key", parsed.data.capability_keys)
      if (error) failed.push(userId)
      else {
        for (const cap of parsed.data.capability_keys) {
          await (admin as any).from("permission_override_history").insert({
            user_id: userId, capability: cap, action: "cleared",
            allow: null, expires_at: null, granted_by: profile.id,
          })
        }
      }
    }
  } else {
    // effect === 'allow' — the only non-clear case after deny was removed.
    const rows = parsed.data.user_ids.flatMap((uid) =>
      parsed.data.capability_keys.map((cap) => ({
        user_id: uid,
        capability_key: cap,
        effect: "allow",
        granted_by: profile.id,
        reason: parsed.data.reason || null,
        expires_at: parsed.data.expires_at ?? null,
      })),
    )
    const { error } = await (admin as any)
      .from("user_permission_overrides")
      .upsert(rows, { onConflict: "user_id,capability_key" })
    if (error) return { ok: false, error: error.message }

    const histRows = parsed.data.user_ids.flatMap((uid) =>
      parsed.data.capability_keys.map((cap) => ({
        user_id: uid,
        capability: cap,
        action: "set_allow",
        allow: true,
        expires_at: parsed.data.expires_at ?? null,
        granted_by: profile.id,
      })),
    )
    await (admin as any).from("permission_override_history").insert(histRows)
  }

  await logActivity({
    actorId: profile.id,
    teamId: null,
    action: "permission.bulk_override",
    entityType: "user_permission_override",
    entityId: profile.id,
    metadata: {
      effect: parsed.data.effect,
      user_count: parsed.data.user_ids.length,
      capability_count: parsed.data.capability_keys.length,
    },
  })

  revalidatePath("/dashboard/permissions")
  return failed.length > 0 ? { ok: true, failed } : { ok: true }
}
