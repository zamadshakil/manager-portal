import "server-only"
import { cache } from "react"
import { redirect } from "next/navigation"

import { createAdminClient } from "@/lib/supabase/admin"
import { requireProfile } from "@/lib/auth"
import type { Profile, UserRole } from "@/lib/types"

// =============================================================================
// Granular Access Control — Central Permission Resolver
// =============================================================================
//
// Single source of truth for "can this user do X?" in app code. The same
// decision is enforced by the Postgres helper `public.has_capability` so RLS
// policies, RPCs, and server actions agree.
//
// Decision rule:
//   1. main_admin → always allow.
//   2. user_permission_overrides 'deny' → false.
//   3. user_permission_overrides 'allow' → true.
//   4. role_permission_defaults match → true.
//   5. otherwise → false.
//
// Resource scope (team / owner / global) is layered on top via
// `hasScopedCapability` and mirrors `public.has_scoped_capability`.
// =============================================================================

// -----------------------------------------------------------------------------
// Capability catalog (kept in sync with the SQL migration)
// -----------------------------------------------------------------------------

export const CAPABILITIES = {
  // tasks
  TASKS_READ: "tasks.read",
  TASKS_CREATE: "tasks.create",
  TASKS_UPDATE: "tasks.update",
  TASKS_DELETE: "tasks.delete",
  TASKS_ASSIGN: "tasks.assign",
  TASKS_AI_ANALYZE: "tasks.ai_analyze",

  // materials
  MATERIALS_READ: "materials.read",
  MATERIALS_CREATE: "materials.create",
  MATERIALS_UPDATE: "materials.update",
  MATERIALS_DELETE: "materials.delete",
  MATERIALS_AI_ANALYZE: "materials.ai_analyze",

  // validation rules
  VALIDATION_RULES_READ: "validation_rules.read",
  VALIDATION_RULES_CREATE: "validation_rules.create",
  VALIDATION_RULES_UPDATE: "validation_rules.update",
  VALIDATION_RULES_DELETE: "validation_rules.delete",
  VALIDATION_RULES_AI_ANALYZE: "validation_rules.ai_analyze",

  // submissions
  SUBMISSIONS_READ: "submissions.read",
  SUBMISSIONS_CREATE: "submissions.create",
  SUBMISSIONS_UPDATE: "submissions.update",
  SUBMISSIONS_DELETE: "submissions.delete",
  SUBMISSIONS_AI_ANALYZE: "submissions.ai_analyze",

  // announcements
  ANNOUNCEMENTS_READ: "announcements.read",
  ANNOUNCEMENTS_CREATE: "announcements.create",
  ANNOUNCEMENTS_UPDATE: "announcements.update",
  ANNOUNCEMENTS_DELETE: "announcements.delete",
  ANNOUNCEMENTS_AI_ANALYZE: "announcements.ai_analyze",

  // ai credits
  AI_CREDITS_READ_SELF: "ai_credits.read_self",
  AI_CREDITS_READ_ALL: "ai_credits.read_all",
  AI_CREDITS_MANAGE: "ai_credits.manage",

  // smart ai
  SMART_AI_CHAT: "smart_ai.chat",
  SMART_AI_ANALYTICS_ALL: "smart_ai.analytics_all",

  // team / user management
  TEAM_MANAGEMENT_READ: "team_management.read",
  TEAM_MANAGEMENT_WRITE: "team_management.write",
  USER_MANAGEMENT_READ: "user_management.read",
  USER_MANAGEMENT_WRITE: "user_management.write",
  USER_MANAGEMENT_PERMISSIONS: "user_management.permissions",
} as const

export type CapabilityKey = (typeof CAPABILITIES)[keyof typeof CAPABILITIES]

// -----------------------------------------------------------------------------
// Shared row types (used by server actions + admin UI)
// -----------------------------------------------------------------------------

export interface PermissionDefinitionRow {
  key: string
  module: string
  action: string
  description: string
  is_admin_only: boolean
}

export interface RoleDefaultRow {
  role: UserRole
  capability_key: string
}

export interface UserOverrideRow {
  user_id: string
  capability_key: string
  effect: "allow" | "deny"
  granted_by: string | null
  granted_by_name: string | null
  reason: string | null
  expires_at: string | null
  updated_at: string
}

// Map RAG `source_type` values → the capability needed to *read* that content
// in retrieval. Used to filter RAG chunks before they reach the LLM.
export const RAG_SOURCE_READ_CAPABILITY: Record<string, CapabilityKey | null> = {
  announcement: CAPABILITIES.ANNOUNCEMENTS_READ,
  material: CAPABILITIES.MATERIALS_READ,
  task: CAPABILITIES.TASKS_READ,
  submission: CAPABILITIES.SUBMISSIONS_READ,
  validation_run: CAPABILITIES.VALIDATION_RULES_READ,
  rule: CAPABILITIES.VALIDATION_RULES_READ,
  // Owner-scoped uploads: capability check is unnecessary because RLS already
  // restricts to the uploader. We still gate behind smart_ai.chat upstream.
  chat_attachment: null,
}

// Same mapping but for the *AI analyze* capability — used as an extra gate so
// the main admin can independently revoke "AI may read X" without revoking
// "user may read X".
export const RAG_SOURCE_AI_CAPABILITY: Record<string, CapabilityKey | null> = {
  announcement: CAPABILITIES.ANNOUNCEMENTS_AI_ANALYZE,
  material: CAPABILITIES.MATERIALS_AI_ANALYZE,
  task: CAPABILITIES.TASKS_AI_ANALYZE,
  submission: CAPABILITIES.SUBMISSIONS_AI_ANALYZE,
  validation_run: CAPABILITIES.VALIDATION_RULES_AI_ANALYZE,
  rule: CAPABILITIES.VALIDATION_RULES_AI_ANALYZE,
  chat_attachment: null,
}

// -----------------------------------------------------------------------------
// Resolver internals
// -----------------------------------------------------------------------------

interface ResolvedPermissions {
  role: UserRole
  /** Set of capability keys effectively granted to this user. */
  capabilities: Set<string>
  /** Capabilities explicitly denied via override. Useful for diagnostics. */
  denies: Set<string>
}

/**
 * Loads + caches the effective capability set for a user for the current
 * request. Wrapped in React.cache so every component / action / API handler in
 * one render shares the same single round-trip.
 */
const loadPermissions = cache(async (
  userId: string,
  role: UserRole,
): Promise<ResolvedPermissions> => {
  // Fast path: main admin gets everything. We never even read the override
  // table for them so an accidental deny override cannot lock them out.
  if (role === "main_admin") {
    return {
      role,
      capabilities: new Set<string>(),  // empty set → has() short-circuits to true
      denies: new Set<string>(),
    }
  }

  const supabase = createAdminClient()

  const [defaultsRes, overridesRes] = await Promise.all([
    supabase
      .from("role_permission_defaults")
      .select("capability_key")
      .eq("role", role),
    (supabase
      .from("user_permission_overrides")
      .select("capability_key, effect, expires_at")
      .eq("user_id", userId)
      .or("expires_at.is.null,expires_at.gt." + new Date().toISOString()) as unknown as Promise<{
        data: { capability_key: string; effect: string; expires_at: string | null }[] | null
        error: { message: string } | null
      }>),
  ])

  if (defaultsRes.error) {
    console.error("[permissions] failed to load role defaults:", defaultsRes.error.message)
  }
  if (overridesRes.error) {
    console.error("[permissions] failed to load user overrides:", overridesRes.error.message)
  }

  const denies = new Set<string>()
  const allows = new Set<string>()
  for (const row of overridesRes.data ?? []) {
    if (row.effect === "deny") denies.add(row.capability_key)
    else if (row.effect === "allow") allows.add(row.capability_key)
  }

  const capabilities = new Set<string>()
  for (const row of defaultsRes.data ?? []) {
    if (!denies.has(row.capability_key)) capabilities.add(row.capability_key)
  }
  for (const cap of allows) {
    if (!denies.has(cap)) capabilities.add(cap)
  }

  return { role, capabilities, denies }
})

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export async function getEffectivePermissions(profile: Profile): Promise<ResolvedPermissions> {
  return loadPermissions(profile.id, profile.role)
}

/**
 * Synchronous capability check given an already-loaded permission set.
 * Prefer `hasCapability` / `requireCapability` in server code — they handle
 * loading + caching for you.
 */
export function hasCapabilityFor(
  perms: ResolvedPermissions,
  capability: CapabilityKey,
): boolean {
  if (perms.role === "main_admin") return true
  if (perms.denies.has(capability)) return false
  return perms.capabilities.has(capability)
}

export async function hasCapability(
  profile: Profile,
  capability: CapabilityKey,
): Promise<boolean> {
  const perms = await loadPermissions(profile.id, profile.role)
  return hasCapabilityFor(perms, capability)
}

export interface ResourceScope {
  team_id?: string | null
  owner_id?: string | null
  is_global?: boolean
}

/**
 * Capability + resource scope check. Mirrors `public.has_scoped_capability`.
 *
 *   - main_admin always passes.
 *   - owner of the resource always passes if they have the capability.
 *   - global resources visible to anyone with the capability.
 *   - otherwise team_id must match.
 */
export async function hasScopedCapability(
  profile: Profile,
  capability: CapabilityKey,
  scope: ResourceScope = {},
): Promise<boolean> {
  if (!(await hasCapability(profile, capability))) return false
  if (profile.role === "main_admin") return true

  if (scope.owner_id && scope.owner_id === profile.id) return true
  if (scope.is_global) return true

  if (scope.team_id == null) return true // capability-only check
  return profile.team_id != null && profile.team_id === scope.team_id
}

/**
 * Loaded permissions + a closure-based checker. Use when a single action
 * needs to make several capability decisions and you want to load once.
 */
export interface AccessContext {
  profile: Profile
  perms: ResolvedPermissions
  has: (capability: CapabilityKey) => boolean
  hasScoped: (capability: CapabilityKey, scope?: ResourceScope) => boolean
}

export async function getAccessContext(profile: Profile): Promise<AccessContext> {
  const perms = await loadPermissions(profile.id, profile.role)
  return {
    profile,
    perms,
    has: (cap) => hasCapabilityFor(perms, cap),
    hasScoped: (cap, scope = {}) => {
      if (!hasCapabilityFor(perms, cap)) return false
      if (profile.role === "main_admin") return true
      if (scope.owner_id && scope.owner_id === profile.id) return true
      if (scope.is_global) return true
      if (scope.team_id == null) return true
      return profile.team_id != null && profile.team_id === scope.team_id
    },
  }
}

// -----------------------------------------------------------------------------
// Server-side guards (mirror requireRole semantics from lib/auth.ts)
// -----------------------------------------------------------------------------

export class AccessDeniedError extends Error {
  capability: CapabilityKey
  constructor(capability: CapabilityKey, message?: string) {
    super(message ?? `Access denied: missing capability "${capability}"`)
    this.name = "AccessDeniedError"
    this.capability = capability
  }
}

/**
 * For server components / pages. Redirects unauthenticated users to login and
 * unauthorized users to the dashboard, matching `requireRole`.
 */
export async function requireCapability(
  capability: CapabilityKey,
  scope?: ResourceScope,
): Promise<{ profile: Profile; ctx: AccessContext }> {
  const profile = await requireProfile()
  const ctx = await getAccessContext(profile)
  const ok = scope ? ctx.hasScoped(capability, scope) : ctx.has(capability)
  if (!ok) redirect("/dashboard")
  return { profile, ctx }
}

/**
 * For server actions. Throws `AccessDeniedError` instead of redirecting so the
 * caller can return a structured `{ ok: false, error }` response.
 */
export async function assertCapability(
  profile: Profile,
  capability: CapabilityKey,
  scope?: ResourceScope,
): Promise<void> {
  const ok = scope
    ? await hasScopedCapability(profile, capability, scope)
    : await hasCapability(profile, capability)
  if (!ok) throw new AccessDeniedError(capability)
}

// -----------------------------------------------------------------------------
// RAG helper — used by the retriever to filter chunks the user shouldn't see.
// -----------------------------------------------------------------------------

/**
 * Returns the list of `source_type` values the user is allowed to retrieve
 * via Smart AI. Combines the *read* and *ai_analyze* capabilities so the
 * admin can independently revoke "the AI can read X" without revoking
 * "the user can read X" in the UI.
 *
 * `chat_attachment` is always allowed because RAG-level filtering already
 * scopes those rows to `owner_id = user`.
 */
export async function aiAllowedRagSourceTypes(profile: Profile): Promise<string[]> {
  const perms = await loadPermissions(profile.id, profile.role)
  const allowed: string[] = ["chat_attachment"]
  for (const sourceType of Object.keys(RAG_SOURCE_READ_CAPABILITY)) {
    const readCap = RAG_SOURCE_READ_CAPABILITY[sourceType]
    const aiCap = RAG_SOURCE_AI_CAPABILITY[sourceType]
    if (readCap && !hasCapabilityFor(perms, readCap)) continue
    if (aiCap && !hasCapabilityFor(perms, aiCap)) continue
    if (!allowed.includes(sourceType)) allowed.push(sourceType)
  }
  return allowed
}
