"use server"

import { randomBytes, createHash } from "node:crypto"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireRole } from "@/lib/auth"
import { logActivity } from "@/lib/activity"
import { sendWelcomeEmail, sendEmailChangeVerification } from "@/lib/email"

// ---------------------------------------------------------------------------
// Email change verification helpers
// ---------------------------------------------------------------------------

/** Token lifetime for the admin-initiated email-change verification link. */
const EMAIL_CHANGE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000 // 24h

function generateEmailChangeToken(): { raw: string; hash: string } {
  // 32 random bytes → 64-char hex token. Hashed with SHA-256 before storage so
  // a database leak cannot be replayed.
  const raw = randomBytes(32).toString("hex")
  const hash = createHash("sha256").update(raw).digest("hex")
  return { raw, hash }
}

function hashEmailChangeToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex")
}

function getCanonicalSiteUrl(): string | null {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.NODE_ENV === "development" ? "http://localhost:3000" : null)
  )
}

function buildVerifyLink(siteUrl: string, userId: string, rawToken: string): string {
  const params = new URLSearchParams({ uid: userId, token: rawToken })
  return `${siteUrl}/auth/confirm-email-change?${params.toString()}`
}

const Schema = z
  .object({
    email: z.string().email(),
    full_name: z.string().trim().min(1).max(200),
    role: z.enum(["main_admin", "manager", "member"]),
    team_id: z.string().uuid().optional().or(z.literal("")),
    password: z.string().min(12, "Password must be at least 12 characters").max(72),
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

  // M-23: A manager can only own one team. Reject up-front if the chosen
  // team already has a different manager assigned. This complements the
  // database-side guard and gives the admin UI a clean error message.
  if (parsed.data.role === "manager" && parsed.data.team_id) {
    const { data: existingTeam } = await admin
      .from("teams")
      .select("manager_id")
      .eq("id", parsed.data.team_id)
      .maybeSingle()
    if (existingTeam?.manager_id) {
      return {
        ok: false,
        error: "This team already has a manager. Reassign the existing manager first.",
      }
    }
  }

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

const UpdateProfileSchema = z.object({
  userId: z.string().uuid(),
  full_name: z.string().trim().min(1, "Full name is required").max(200),
  email: z.string().email("Invalid email address"),
})

/**
 * Update a user's full name and/or email. Only main_admin can do this.
 *
 * Logical flow:
 *   1. Full-name only changes are written through immediately (low risk).
 *   2. Email changes do NOT touch the auth email up front. Instead we:
 *        - Validate the new address is not already used (auth + profiles).
 *        - Generate a single-use, hashed verification token (24h TTL).
 *        - Stash `pending_email`, the token hash, and expiry on the profile.
 *        - Send a verification link to the NEW mailbox.
 *      The actual swap only happens once the user clicks the link, which is
 *      handled by `confirmEmailChange` below. Until then the UI shows the
 *      account as "Email under verification".
 *
 * Returns `pendingEmail` so the caller can adjust UI copy.
 */
export async function updateUserProfile(
  userId: string,
  fullName: string,
  email: string,
): Promise<{ ok: boolean; error?: string; pendingEmail?: string }> {
  const actor = await requireRole(["main_admin"])

  const parsed = UpdateProfileSchema.safeParse({ userId, full_name: fullName, email })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }

  const admin = createAdminClient()

  // Load the current profile so we know what changed and what to compare to.
  const { data: targetProfile, error: targetErr } = await admin
    .from("profiles")
    .select("id, email, full_name, pending_email")
    .eq("id", parsed.data.userId)
    .maybeSingle()

  if (targetErr) {
    console.error("[updateUserProfile] profile lookup error:", targetErr.message)
    return { ok: false, error: `Database error: ${targetErr.message}` }
  }
  if (!targetProfile) {
    return { ok: false, error: "User not found." }
  }

  const currentEmail = (targetProfile.email ?? "").trim().toLowerCase()
  const requestedEmail = parsed.data.email.trim().toLowerCase()
  const currentName = (targetProfile.full_name ?? "").trim()
  const requestedName = parsed.data.full_name.trim()
  const emailChanged = requestedEmail !== currentEmail

  // ---------------------------------------------------------------------
  // 1. Always sync the full name immediately if it changed.
  // ---------------------------------------------------------------------
  if (requestedName !== currentName) {
    const { error: authNameErr } = await admin.auth.admin.updateUserById(parsed.data.userId, {
      user_metadata: { full_name: requestedName },
    })
    if (authNameErr) {
      console.error("[updateUserProfile] auth metadata update failed:", authNameErr.message)
      return { ok: false, error: "Could not update user credentials." }
    }
    const { error: profileNameErr } = await admin
      .from("profiles")
      .update({ full_name: requestedName })
      .eq("id", parsed.data.userId)
    if (profileNameErr) {
      console.error("[updateUserProfile] profile name update failed:", profileNameErr.message)
      return { ok: false, error: "Could not update profile." }
    }
  }

  // ---------------------------------------------------------------------
  // 2. If only the name changed, we're done. Optionally clear any stale
  //    pending email change request from earlier sessions.
  // ---------------------------------------------------------------------
  if (!emailChanged) {
    await logActivity({
      actorId: actor.id,
      teamId: null,
      action: "user.profile_updated",
      entityType: "profile",
      entityId: parsed.data.userId,
      metadata: { full_name: requestedName, email: targetProfile.email },
    })
    revalidatePath("/dashboard/team")
    revalidatePath("/dashboard/admin/users")
    return { ok: true }
  }

  // ---------------------------------------------------------------------
  // 3. Email change → verification flow.
  // ---------------------------------------------------------------------
  // 3a. Reject if the new address already belongs to another active profile.
  const { data: collidingProfile } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", parsed.data.email)
    .neq("id", parsed.data.userId)
    .maybeSingle()
  if (collidingProfile) {
    return { ok: false, error: "That email is already in use by another account." }
  }

  // 3b. Reject if another user already has a pending change to that address.
  const { data: collidingPending } = await admin
    .from("profiles")
    .select("id")
    .ilike("pending_email", parsed.data.email)
    .neq("id", parsed.data.userId)
    .maybeSingle()
  if (collidingPending) {
    return { ok: false, error: "That email already has a verification pending on another account." }
  }

  // 3c. We need a valid site URL to build the verification link. Without it
  //     we cannot safely deliver the user a working confirmation page.
  const siteUrl = getCanonicalSiteUrl()
  if (!siteUrl) {
    console.error("[updateUserProfile] NEXT_PUBLIC_SITE_URL not set — cannot generate verification link.")
    return { ok: false, error: "Server is not configured to send verification links." }
  }

  // 3d. Generate token + persist hashed copy on the profile row.
  const { raw, hash } = generateEmailChangeToken()
  const expiresAt = new Date(Date.now() + EMAIL_CHANGE_TOKEN_TTL_MS).toISOString()

  const { error: pendingErr } = await admin
    .from("profiles")
    .update({
      pending_email: parsed.data.email,
      email_change_token_hash: hash,
      email_change_token_expires_at: expiresAt,
      email_change_requested_at: new Date().toISOString(),
      email_change_requested_by: actor.id,
    })
    .eq("id", parsed.data.userId)

  if (pendingErr) {
    console.error("[updateUserProfile] could not persist pending email change:", pendingErr.message)
    return { ok: false, error: "Could not stage the email change. Please try again." }
  }

  // 3e. Send the verification email to the NEW address.
  const verifyLink = buildVerifyLink(siteUrl, parsed.data.userId, raw)
  const sent = await sendEmailChangeVerification({
    newEmail: parsed.data.email,
    oldEmail: targetProfile.email ?? "",
    fullName: requestedName || targetProfile.full_name || parsed.data.email,
    verifyLink,
    expiresAt,
  }).catch((err) => {
    console.error("[updateUserProfile] sendEmailChangeVerification threw:", err)
    return false
  })

  if (!sent) {
    // Roll back the pending state so the admin can retry without a stuck row.
    await admin
      .from("profiles")
      .update({
        pending_email: null,
        email_change_token_hash: null,
        email_change_token_expires_at: null,
        email_change_requested_at: null,
        email_change_requested_by: null,
      })
      .eq("id", parsed.data.userId)
    return { ok: false, error: "Could not send the verification email. Please try again." }
  }

  await logActivity({
    actorId: actor.id,
    teamId: null,
    action: "user.email_change_requested",
    entityType: "profile",
    entityId: parsed.data.userId,
    metadata: {
      old_email: targetProfile.email ?? null,
      new_email: parsed.data.email,
    },
  })

  revalidatePath("/dashboard/team")
  revalidatePath("/dashboard/admin/users")
  return { ok: true, pendingEmail: parsed.data.email }
}

// ---------------------------------------------------------------------------
// Cancel / resend / confirm helpers for the email-change verification flow.
// ---------------------------------------------------------------------------

/**
 * Cancels a pending admin-initiated email change. The user keeps their
 * original email. Only main_admin can do this.
 */
export async function cancelPendingEmailChange(
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  const actor = await requireRole(["main_admin"])
  if (!z.string().uuid().safeParse(userId).success) {
    return { ok: false, error: "Invalid user ID." }
  }
  const admin = createAdminClient()

  const { data: target, error: targetErr } = await admin
    .from("profiles")
    .select("id, email, pending_email")
    .eq("id", userId)
    .maybeSingle()

  if (targetErr || !target) return { ok: false, error: "User not found." }
  if (!target.pending_email) return { ok: true } // nothing to cancel

  const { error: clearErr } = await admin
    .from("profiles")
    .update({
      pending_email: null,
      email_change_token_hash: null,
      email_change_token_expires_at: null,
      email_change_requested_at: null,
      email_change_requested_by: null,
    })
    .eq("id", userId)

  if (clearErr) return { ok: false, error: "Could not cancel the pending change." }

  await logActivity({
    actorId: actor.id,
    teamId: null,
    action: "user.email_change_cancelled",
    entityType: "profile",
    entityId: userId,
    metadata: { old_email: target.email, cancelled_pending_email: target.pending_email },
  })

  revalidatePath("/dashboard/team")
  revalidatePath("/dashboard/admin/users")
  return { ok: true }
}

/**
 * Resends the verification email for an existing pending change. Generates
 * a brand-new token (rotating the old one out so previously-sent links are
 * invalidated). Only main_admin can do this.
 */
export async function resendEmailChangeVerification(
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  const actor = await requireRole(["main_admin"])
  if (!z.string().uuid().safeParse(userId).success) {
    return { ok: false, error: "Invalid user ID." }
  }
  const admin = createAdminClient()

  const { data: target, error: targetErr } = await admin
    .from("profiles")
    .select("id, email, full_name, pending_email")
    .eq("id", userId)
    .maybeSingle()

  if (targetErr || !target) return { ok: false, error: "User not found." }
  if (!target.pending_email) {
    return { ok: false, error: "No pending email change to resend." }
  }

  const siteUrl = getCanonicalSiteUrl()
  if (!siteUrl) return { ok: false, error: "Server is not configured to send verification links." }

  const { raw, hash } = generateEmailChangeToken()
  const expiresAt = new Date(Date.now() + EMAIL_CHANGE_TOKEN_TTL_MS).toISOString()

  const { error: rotateErr } = await admin
    .from("profiles")
    .update({
      email_change_token_hash: hash,
      email_change_token_expires_at: expiresAt,
      email_change_requested_at: new Date().toISOString(),
      email_change_requested_by: actor.id,
    })
    .eq("id", userId)

  if (rotateErr) return { ok: false, error: "Could not rotate the verification token." }

  const verifyLink = buildVerifyLink(siteUrl, userId, raw)
  const sent = await sendEmailChangeVerification({
    newEmail: target.pending_email,
    oldEmail: target.email ?? "",
    fullName: target.full_name ?? target.pending_email,
    verifyLink,
    expiresAt,
  }).catch((err) => {
    console.error("[resendEmailChangeVerification] send threw:", err)
    return false
  })

  if (!sent) return { ok: false, error: "Could not send the verification email." }

  await logActivity({
    actorId: actor.id,
    teamId: null,
    action: "user.email_change_resent",
    entityType: "profile",
    entityId: userId,
    metadata: { pending_email: target.pending_email },
  })

  revalidatePath("/dashboard/team")
  revalidatePath("/dashboard/admin/users")
  return { ok: true }
}

/**
 * Finalize a pending email change. Called by the public confirmation page
 * (`/auth/confirm-email-change`) after the user clicks the link in their
 * NEW mailbox. Validates the single-use token, then performs the swap on
 * both `auth.users.email` and `public.profiles.email` and clears the
 * pending fields.
 *
 * This is intentionally NOT gated by `requireRole` — the token IS the proof
 * of authorization, since only the owner of the new mailbox can have read it.
 */
export async function confirmEmailChange(
  userId: string,
  rawToken: string,
): Promise<{ ok: boolean; error?: string; newEmail?: string }> {
  if (!z.string().uuid().safeParse(userId).success) {
    return { ok: false, error: "Invalid confirmation link." }
  }
  if (typeof rawToken !== "string" || rawToken.length < 32 || rawToken.length > 256) {
    return { ok: false, error: "Invalid confirmation link." }
  }

  const admin = createAdminClient()
  const expectedHash = hashEmailChangeToken(rawToken)

  const { data: target, error: targetErr } = await admin
    .from("profiles")
    .select(
      "id, email, full_name, pending_email, email_change_token_hash, email_change_token_expires_at",
    )
    .eq("id", userId)
    .maybeSingle()

  if (targetErr || !target) {
    return { ok: false, error: "Confirmation link is no longer valid." }
  }

  if (
    !target.pending_email ||
    !target.email_change_token_hash ||
    !target.email_change_token_expires_at
  ) {
    return { ok: false, error: "There is no pending email change for this account." }
  }

  if (target.email_change_token_hash !== expectedHash) {
    return { ok: false, error: "Confirmation link is invalid or has already been used." }
  }

  if (new Date(target.email_change_token_expires_at).getTime() < Date.now()) {
    return { ok: false, error: "Confirmation link has expired. Ask your administrator to resend it." }
  }

  // Race-guard: re-check that nobody else snatched this email while the link
  // was sitting in someone's inbox.
  const { data: collidingProfile } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", target.pending_email)
    .neq("id", userId)
    .maybeSingle()
  if (collidingProfile) {
    return { ok: false, error: "That email is already in use by another account." }
  }

  // Perform the actual swap.
  const { error: authError } = await admin.auth.admin.updateUserById(userId, {
    email: target.pending_email,
    email_confirm: true,
  })
  if (authError) {
    console.error("[confirmEmailChange] auth update failed:", authError.message)
    return { ok: false, error: "Could not finalize the email change." }
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({
      email: target.pending_email,
      pending_email: null,
      email_change_token_hash: null,
      email_change_token_expires_at: null,
      email_change_requested_at: null,
      email_change_requested_by: null,
    })
    .eq("id", userId)

  if (profileError) {
    console.error("[confirmEmailChange] profile update failed:", profileError.message)
    return { ok: false, error: "Could not finalize the email change." }
  }

  await logActivity({
    actorId: userId,
    teamId: null,
    action: "user.email_change_confirmed",
    entityType: "profile",
    entityId: userId,
    metadata: { old_email: target.email, new_email: target.pending_email },
  })

  revalidatePath("/dashboard/team")
  revalidatePath("/dashboard/admin/users")
  return { ok: true, newEmail: target.pending_email }
}

const RoleTransitionSchema = z.object({
  userId: z.string().uuid(),
  newRole: z.enum(["main_admin", "manager", "member"]),
})

/**
 * Update a user's role. Only main_admin can do this.
 * Reconfigures ACL, validates last admin guardrail, updates metadata,
 * invalidates sessions, and logs the activity.
 */
export async function updateUserRole(userId: string, newRole: "main_admin" | "manager" | "member"): Promise<{ ok: boolean; error?: string }> {
  const actor = await requireRole(["main_admin"])
  const parsed = RoleTransitionSchema.safeParse({ userId, newRole })
  
  if (!parsed.success) return { ok: false, error: "Invalid input" }

  if (userId === actor.id && newRole !== "main_admin") {
    return { ok: false, error: "You cannot demote yourself." }
  }

  const admin = createAdminClient()

  // Last admin check
  const { data: currentProfile, error: profileError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single()

  if (profileError || !currentProfile) {
    return { ok: false, error: "User not found." }
  }

  if (currentProfile.role === "main_admin" && newRole !== "main_admin") {
    const { count, error: countError } = await admin
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("role", "main_admin")

    if (countError) return { ok: false, error: "Failed to verify admin count." }
    if (count !== null && count <= 1) {
      return { ok: false, error: "Cannot demote the last main admin account. System requires at least one active main admin." }
    }
  }

  if (currentProfile.role === newRole) {
    return { ok: true } // No change needed
  }

  // 1. Update the profile row
  const { error: updateError } = await admin
    .from("profiles")
    .update({ role: newRole })
    .eq("id", userId)

  if (updateError) return { ok: false, error: "Could not update user role." }

  // 2. Sync the role into Supabase Auth metadata
  await admin.auth.admin.updateUserById(userId, {
    user_metadata: { role: newRole },
  })

  // 3. Real-time session invalidation (kills active tokens)
  await admin.rpc("invalidate_user_sessions", { target_user_id: userId })

  // 4. Immutable Audit Trail
  await logActivity({
    actorId: actor.id,
    teamId: null,
    action: "user.role_changed",
    entityType: "profile",
    entityId: userId,
    metadata: {
      old_role: currentProfile.role,
      new_role: newRole,
    },
  })

  revalidatePath("/dashboard/team")
  revalidatePath("/dashboard/admin/users")
  return { ok: true }
}
