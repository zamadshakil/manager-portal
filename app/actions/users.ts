"use server"

import { randomBytes, createHash } from "node:crypto"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireRole } from "@/lib/auth"
import { logActivity } from "@/lib/activity"
import { sendWelcomeEmail, sendEmailChangeVerification, sendEmailChangeAlert } from "@/lib/email"
import { getCanonicalSiteUrl } from "@/lib/site-url"

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

function buildVerifyLink(siteUrl: string, userId: string, rawToken: string): string {
  const params = new URLSearchParams({ uid: userId, token: rawToken })
  return `${siteUrl}/auth/confirm-email-change?${params.toString()}`
}

// ---------------------------------------------------------------------------
// Deleted-user email recovery helpers
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function isEmailAlreadyRegisteredError(message?: string): boolean {
  const normalized = (message ?? "").toLowerCase()
  return (
    normalized.includes("already been registered") ||
    normalized.includes("already registered") ||
    normalized.includes("already exists")
  )
}

async function findAuthUserByEmail(admin: AdminClient, email: string) {
  const target = normalizeEmail(email)
  const perPage = 200
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) {
      console.error("[findAuthUserByEmail] listUsers failed:", error.message)
      return null
    }
    const match = data.users.find((u) => normalizeEmail(u.email ?? "") === target)
    if (match) return match
    if (data.users.length < perPage) break
  }
  return null
}

/**
 * If the email is reserved by a soft-deleted profile (and/or a leftover auth
 * record), release it so a fresh user can be provisioned with that address.
 */
async function releaseDeletedEmailReservation(
  admin: AdminClient,
  email: string,
): Promise<{ ok: boolean; released: boolean; error?: string }> {
  const target = normalizeEmail(email)
  const authUser = await findAuthUserByEmail(admin, target)

  if (authUser) {
    // Verify the matching auth user actually belongs to a deleted profile
    const { data: authProfile } = await admin
      .from("profiles")
      .select("id, deleted_at")
      .eq("id", authUser.id)
      .maybeSingle()

    if (authProfile && !authProfile.deleted_at) {
      // Active user still owns this email
      return {
        ok: false,
        released: false,
        error: "A user with this email address has already been registered.",
      }
    }

    // Instead of hard-deleting (which cascades via FK and may fail due to
    // references from messages / activity_log), reassign the auth email to
    // an archived placeholder so the original address becomes available.
    const archivedEmail = `deleted-${authUser.id}@archived.local`
    const { error: swapError } = await admin.auth.admin.updateUserById(authUser.id, {
      email: archivedEmail,
      email_confirm: true,
    })
    if (swapError) {
      console.error("[releaseDeletedEmailReservation] auth email swap failed:", swapError.message)
      return {
        ok: false,
        released: false,
        error: "Could not clear the deleted account. Please contact support.",
      }
    }
  }

  // Also archive the email on any soft-deleted profile rows so the
  // on_auth_user_created trigger can insert a fresh profile without conflict.
  const { data: archivedProfiles } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", target)
    .not("deleted_at", "is", null)

  for (const p of archivedProfiles ?? []) {
    await admin
      .from("profiles")
      .update({ email: `deleted-${p.id}@archived.local` })
      .eq("id", p.id)
  }

  return { ok: true, released: Boolean(authUser) || (archivedProfiles?.length ?? 0) > 0 }
}

const Schema = z
  .object({
    email: z
      .string()
      .email()
      .transform((s) => s.trim().toLowerCase()),
    full_name: z.string().trim().min(1).max(200),
    role: z.enum(["main_admin", "manager", "member"]),
    team_id: z.string().uuid().optional().or(z.literal("")),
    password: z.string().min(12, "Password must be at least 12 characters").max(72),
    monthly_ai_limit: z.coerce.number().int().min(1).max(10000).optional().default(100),
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
    monthly_ai_limit: formData.get("monthly_ai_limit") ?? undefined,
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

  const createUserInput = {
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: {
      full_name: parsed.data.full_name,
      role: parsed.data.role,
      team_id: parsed.data.team_id || null,
      must_reset: true,
    },
  }

  let { data, error } = await admin.auth.admin.createUser(createUserInput)

  // If Supabase Auth says the email is taken, check whether it belongs to a
  // soft-deleted user and automatically release the reservation before retrying.
  if (error && isEmailAlreadyRegisteredError(error.message)) {
    const recovered = await releaseDeletedEmailReservation(admin, parsed.data.email)
    if (!recovered.ok) {
      return { ok: false, error: recovered.error ?? error.message ?? "Could not create user." }
    }
    if (recovered.released) {
      const retried = await admin.auth.admin.createUser(createUserInput)
      data = retried.data
      error = retried.error
    }
  }

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
        monthly_limit: parsed.data.monthly_ai_limit,
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
  }).catch((err) => {
    console.error("[provisionUser] Failed to send welcome email:", err)
  })

  revalidatePath("/dashboard/team")
  revalidatePath("/dashboard/admin/users")
  return { ok: true }
}

/**
 * Delete a user account. Only main_admin can do this.
 * Uses soft-delete on profiles to preserve chat history (messages remain
 * with sender attribution). The user is removed from Supabase Auth to
 * prevent login, but the profile row persists with deleted_at set.
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

  // Fetch the target profile for logging
  const { data: targetProfile, error: profileError } = await admin
    .from("profiles")
    .select("email, full_name, role, deleted_at")
    .eq("id", userId)
    .maybeSingle()

  if (profileError) {
    console.error("[deleteUser] profile lookup error:", profileError.message)
  }

  // Already soft-deleted — nothing to do
  if (targetProfile?.deleted_at) {
    return { ok: true }
  }

  // Free the email in Supabase Auth so it can be reused. We swap the email
  // to an archived placeholder instead of hard-deleting the auth record,
  // because ON DELETE CASCADE from auth.users → profiles would conflict with
  // FK references from messages / activity_log.
  const archivedEmail = `deleted-${userId}@archived.local`
  const { error: authSwapError } = await admin.auth.admin.updateUserById(userId, {
    email: archivedEmail,
    email_confirm: true,
    ban_duration: "876600h", // ~100 years – effectively permanent ban
  })
  if (authSwapError) {
    if (authSwapError.message.toLowerCase().includes("not found")) {
      console.warn("[deleteUser] auth user not found for userId:", userId, "— proceeding with profile soft-delete (possible auth/profile drift).")
    } else {
      console.error("[deleteUser] auth email swap failed:", authSwapError.message)
      return { ok: false, error: `Could not delete user: ${authSwapError.message}` }
    }
  }

  // Soft-delete the profile row — preserves FK integrity + message attribution.
  // Core fields (deleted_at, email) are guaranteed to exist; update them first.
  const { error: softDeleteError } = await admin
    .from("profiles")
    .update({
      deleted_at: new Date().toISOString(),
      email: archivedEmail,
    })
    .eq("id", userId)

  if (softDeleteError) {
    console.error("[deleteUser] profile soft-delete error:", softDeleteError.message)
    return {
      ok: false,
      error: `Could not delete user: ${softDeleteError.message}`,
    }
  }

  // Best-effort: clear email-change pending fields. These columns are added by
  // the 20260507_email_change_verification migration; if they don't yet exist
  // in the schema we log a warning but do NOT fail the delete.
  const { error: cleanupError } = await admin
    .from("profiles")
    .update({
      pending_email: null,
      email_change_token_hash: null,
      email_change_token_expires_at: null,
      email_change_requested_at: null,
      email_change_requested_by: null,
    })
    .eq("id", userId)

  if (cleanupError) {
    console.warn("[deleteUser] email-change field cleanup skipped (columns may not exist yet):", cleanupError.message)
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
  email: z
    .string()
    .email("Invalid email address")
    .transform((s) => s.trim().toLowerCase()),
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
    .is("deleted_at", null)
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
    .is("deleted_at", null)
    .neq("id", parsed.data.userId)
    .maybeSingle()
  if (collidingPending) {
    return { ok: false, error: "That email already has a verification pending on another account." }
  }

  // 3c. Build the verification link. Falls back to the hardcoded production URL
  //     when NEXT_PUBLIC_SITE_URL is absent so we never silently block the flow.
  const siteUrl = getCanonicalSiteUrl()

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

  // 3f. Non-blocking security alert to the OLD address so the account holder
  //     knows their email is being changed before it takes effect.
  sendEmailChangeAlert({
    oldEmail: targetProfile.email ?? "",
    newEmail: parsed.data.email,
    fullName: requestedName || targetProfile.full_name || parsed.data.email,
    expiresAt,
  }).catch((err) => {
    console.warn("[updateUserProfile] sendEmailChangeAlert to old address threw:", err)
  })

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
    .is("deleted_at", null)
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
  teamId: z.string().uuid().nullable().optional(),
})

/**
 * Update a user's role. Only main_admin can do this.
 *
 * Invariants enforced:
 *   - Last main_admin cannot be demoted.
 *   - A user transitioning INTO `manager` MUST be assigned an available team
 *     (`teams.manager_id` null or already pointing at them). The server both
 *     writes `profiles.team_id` and claims `teams.manager_id` in one pass.
 *   - A user transitioning OUT of `manager` releases any team they owned
 *     (`teams.manager_id` is cleared) so it can be reassigned. If moving to
 *     `member`, their `profiles.team_id` is also cleared.
 *   - AI credit `is_unlimited` flag is kept in sync with role: main_admin →
 *     unlimited, everyone else → capped. A missing credit row is created.
 *
 * Side-effects: updates auth metadata, invalidates active sessions, writes
 * an activity log entry, and revalidates the relevant dashboard routes.
 */
export async function updateUserRole(
  userId: string,
  newRole: "main_admin" | "manager" | "member",
  teamId?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const actor = await requireRole(["main_admin"])
  const parsed = RoleTransitionSchema.safeParse({ userId, newRole, teamId })

  if (!parsed.success) return { ok: false, error: "Invalid input" }

  if (userId === actor.id && newRole !== "main_admin") {
    return { ok: false, error: "You cannot demote yourself." }
  }

  const admin = createAdminClient()

  const { data: currentProfile, error: profileError } = await admin
    .from("profiles")
    .select("role, team_id")
    .eq("id", userId)
    .single()

  if (profileError || !currentProfile) {
    return { ok: false, error: "User not found." }
  }

  // Last admin check
  if (currentProfile.role === "main_admin" && newRole !== "main_admin") {
    const { count, error: countError } = await admin
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("role", "main_admin")
      .is("deleted_at", null)

    if (countError) return { ok: false, error: "Failed to verify admin count." }
    if (count !== null && count <= 1) {
      return { ok: false, error: "Cannot demote the last main admin account. System requires at least one active main admin." }
    }
  }

  // Managers must own a team. Validate the selection up-front.
  const normalizedTeamId = parsed.data.teamId ?? null
  if (newRole === "manager") {
    if (!normalizedTeamId) {
      return {
        ok: false,
        error: "A team must be selected when assigning the Manager role.",
      }
    }
    const { data: targetTeam, error: teamErr } = await admin
      .from("teams")
      .select("id, manager_id")
      .eq("id", normalizedTeamId)
      .maybeSingle()
    if (teamErr) return { ok: false, error: "Could not verify the selected team." }
    if (!targetTeam) return { ok: false, error: "Selected team does not exist." }
    if (targetTeam.manager_id && targetTeam.manager_id !== userId) {
      return {
        ok: false,
        error: "Selected team already has a manager. Reassign the existing manager first.",
      }
    }
  }

  // No-op when nothing changes (including team, for manager-stays-manager case).
  const roleUnchanged = currentProfile.role === newRole
  const teamUnchanged =
    newRole !== "manager" || normalizedTeamId === currentProfile.team_id
  if (roleUnchanged && teamUnchanged) {
    return { ok: true }
  }

  // 1. If leaving manager, release any team we were pointing at.
  if (currentProfile.role === "manager" && newRole !== "manager") {
    const { error: clearTeamErr } = await admin
      .from("teams")
      .update({ manager_id: null })
      .eq("manager_id", userId)
    if (clearTeamErr) {
      console.error("[updateUserRole] failed to release old manager team:", clearTeamErr.message)
    }
  }

  // 2. If moving manager between teams, release the old one first.
  if (
    currentProfile.role === "manager" &&
    newRole === "manager" &&
    currentProfile.team_id &&
    currentProfile.team_id !== normalizedTeamId
  ) {
    const { error: releaseErr } = await admin
      .from("teams")
      .update({ manager_id: null })
      .eq("id", currentProfile.team_id)
      .eq("manager_id", userId)
    if (releaseErr) {
      console.error("[updateUserRole] failed to release previous team:", releaseErr.message)
    }
  }

  // 3. Build and apply the profile row update.
  const profileUpdate: { role: typeof newRole; team_id?: string | null } = {
    role: newRole,
  }
  if (newRole === "manager") {
    profileUpdate.team_id = normalizedTeamId
  } else if (currentProfile.role === "manager" && newRole === "member") {
    // Demoted manager becomes unassigned — they no longer "own" the team.
    profileUpdate.team_id = null
  }
  // main_admin: leave team_id as-is (admins are cross-team by convention).

  const { error: updateError } = await admin
    .from("profiles")
    .update(profileUpdate)
    .eq("id", userId)

  if (updateError) return { ok: false, error: "Could not update user role." }

  // 4. Claim the new team's manager pointer.
  if (newRole === "manager" && normalizedTeamId) {
    const { error: claimErr } = await admin
      .from("teams")
      .update({ manager_id: userId })
      .eq("id", normalizedTeamId)
    if (claimErr) {
      console.error("[updateUserRole] failed to claim new team:", claimErr.message)
    }
  }

  // 5. Sync Supabase Auth metadata (role + team).
  const effectiveTeamId =
    "team_id" in profileUpdate ? profileUpdate.team_id ?? null : currentProfile.team_id ?? null
  await admin.auth.admin.updateUserById(userId, {
    user_metadata: {
      role: newRole,
      team_id: effectiveTeamId,
    },
  })

  // 6. Kill active sessions so the new role takes effect immediately.
  await admin.rpc("invalidate_user_sessions", { target_user_id: userId })

  // 7. Keep AI credit unlimited flag in sync with role.
  try {
    const { data: existingCredit } = await admin
      .from("ai_credit_limits")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle()

    if (existingCredit) {
      await admin
        .from("ai_credit_limits")
        .update({
          is_unlimited: newRole === "main_admin",
          updated_by: actor.id,
        })
        .eq("user_id", userId)
    } else {
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)
      await admin.from("ai_credit_limits").insert({
        user_id: userId,
        monthly_limit: 100,
        used_this_period: 0,
        period_type: "monthly",
        period_start: monthStart,
        period_end: monthEnd,
        is_unlimited: newRole === "main_admin",
        updated_by: actor.id,
      })
    }
  } catch (credErr: any) {
    console.warn("[updateUserRole] could not sync AI credit row:", credErr?.message ?? credErr)
  }

  // 8. Immutable audit trail.
  await logActivity({
    actorId: actor.id,
    teamId: effectiveTeamId,
    action: "user.role_changed",
    entityType: "profile",
    entityId: userId,
    metadata: {
      old_role: currentProfile.role,
      new_role: newRole,
      old_team_id: currentProfile.team_id,
      new_team_id: effectiveTeamId,
    },
  })

  revalidatePath("/dashboard/team")
  revalidatePath("/dashboard/admin/users")
  revalidatePath("/dashboard/departments")
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Team reassignment (main_admin only)
// ---------------------------------------------------------------------------

/**
 * Move a user to a different team (or clear their team). Enforces the
 * "managers own exactly one team" invariant: a manager cannot be reassigned
 * to a team that already has a different manager, and cannot be left
 * team-less. Only main_admin can do this.
 */
export async function updateUserTeam(
  userId: string,
  teamId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const actor = await requireRole(["main_admin"])

  if (!z.string().uuid().safeParse(userId).success) {
    return { ok: false, error: "Invalid user ID." }
  }
  if (teamId !== null && !z.string().uuid().safeParse(teamId).success) {
    return { ok: false, error: "Invalid team selection." }
  }

  const admin = createAdminClient()

  const { data: currentProfile, error: profileError } = await admin
    .from("profiles")
    .select("role, team_id")
    .eq("id", userId)
    .maybeSingle()

  if (profileError || !currentProfile) {
    return { ok: false, error: "User not found." }
  }

  if ((currentProfile.team_id ?? null) === teamId) {
    return { ok: true }
  }

  // Managers must own a team, and the destination team must not already
  // belong to a different manager.
  if (currentProfile.role === "manager") {
    if (!teamId) {
      return {
        ok: false,
        error: "Managers must own a team. Demote the user first if they should not lead a team.",
      }
    }
    const { data: targetTeam, error: teamErr } = await admin
      .from("teams")
      .select("id, manager_id")
      .eq("id", teamId)
      .maybeSingle()
    if (teamErr) return { ok: false, error: "Could not verify the selected team." }
    if (!targetTeam) return { ok: false, error: "Selected team does not exist." }
    if (targetTeam.manager_id && targetTeam.manager_id !== userId) {
      return {
        ok: false,
        error: "Selected team already has a manager. Reassign the existing manager first.",
      }
    }
  }

  // Release the current team's manager pointer if the user owned it.
  if (currentProfile.role === "manager" && currentProfile.team_id) {
    await admin
      .from("teams")
      .update({ manager_id: null })
      .eq("id", currentProfile.team_id)
      .eq("manager_id", userId)
  }

  const { error: updateErr } = await admin
    .from("profiles")
    .update({ team_id: teamId })
    .eq("id", userId)
  if (updateErr) return { ok: false, error: "Could not update team assignment." }

  // Claim the new team for managers.
  if (currentProfile.role === "manager" && teamId) {
    await admin.from("teams").update({ manager_id: userId }).eq("id", teamId)
  }

  // Keep auth metadata in sync so client-side role checks stay accurate.
  await admin.auth.admin.updateUserById(userId, {
    user_metadata: { team_id: teamId },
  })

  await logActivity({
    actorId: actor.id,
    teamId,
    action: "user.team_changed",
    entityType: "profile",
    entityId: userId,
    metadata: {
      old_team_id: currentProfile.team_id,
      new_team_id: teamId,
    },
  })

  revalidatePath("/dashboard/team")
  revalidatePath("/dashboard/admin/users")
  revalidatePath("/dashboard/departments")
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Admin-initiated password reset (temporary password handed back to the admin)
// ---------------------------------------------------------------------------

const TEMP_PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*"

function generateTempPassword(length = 16): string {
  const bytes = randomBytes(length)
  let out = ""
  for (let i = 0; i < length; i++) {
    out += TEMP_PASSWORD_ALPHABET[bytes[i] % TEMP_PASSWORD_ALPHABET.length]
  }
  return out
}

/**
 * Generates a fresh temporary password for `userId`, writes it to Supabase
 * Auth, flags the profile with `must_reset = true`, and returns the plaintext
 * password back to the admin caller so they can share it through a secure
 * out-of-band channel. Only main_admin may invoke this.
 *
 * Self-reset is rejected — the admin should use the normal sign-in /
 * settings flow to change their own password.
 */
export async function resetUserPassword(
  userId: string,
): Promise<{ ok: boolean; error?: string; tempPassword?: string }> {
  const actor = await requireRole(["main_admin"])

  if (!z.string().uuid().safeParse(userId).success) {
    return { ok: false, error: "Invalid user ID." }
  }
  if (userId === actor.id) {
    return {
      ok: false,
      error: "Use your profile settings to change your own password.",
    }
  }

  const admin = createAdminClient()

  const { data: target, error: targetErr } = await admin
    .from("profiles")
    .select("id, email, deleted_at")
    .eq("id", userId)
    .maybeSingle()
  if (targetErr || !target) return { ok: false, error: "User not found." }
  if (target.deleted_at) {
    return { ok: false, error: "Cannot reset password for a deleted account." }
  }

  const tempPassword = generateTempPassword(16)

  const { error: authErr } = await admin.auth.admin.updateUserById(userId, {
    password: tempPassword,
    user_metadata: { must_reset: true },
  })
  if (authErr) {
    console.error("[resetUserPassword] auth update failed:", authErr.message)
    return { ok: false, error: "Could not reset the password. Please try again." }
  }

  const { error: profileErr } = await admin
    .from("profiles")
    .update({ must_reset: true })
    .eq("id", userId)
  if (profileErr) {
    console.warn("[resetUserPassword] could not flag profile must_reset:", profileErr.message)
  }

  await logActivity({
    actorId: actor.id,
    teamId: null,
    action: "user.password_reset",
    entityType: "profile",
    entityId: userId,
    metadata: { email: target.email },
  })

  revalidatePath("/dashboard/team")
  revalidatePath("/dashboard/admin/users")
  return { ok: true, tempPassword }
}
