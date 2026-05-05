"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requireProfile, requireRole } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { logActivity } from "@/lib/activity"
import type { AiCreditLimit, AiCreditPeriod, AiUsageLogEntry } from "@/lib/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computePeriodBounds(periodType: AiCreditPeriod): {
  period_start: string
  period_end: string
} {
  const now = new Date()

  if (periodType === "daily") {
    const d = now.toISOString().slice(0, 10)
    return { period_start: d, period_end: d }
  }

  if (periodType === "weekly") {
    // Week starts Monday
    const day = now.getDay() // 0=Sun
    const diff = (day === 0 ? -6 : 1 - day)
    const monday = new Date(now)
    monday.setDate(now.getDate() + diff)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    return {
      period_start: monday.toISOString().slice(0, 10),
      period_end: sunday.toISOString().slice(0, 10),
    }
  }

  // monthly (default)
  const year = now.getFullYear()
  const month = now.getMonth() // 0-indexed
  const start = new Date(year, month, 1).toISOString().slice(0, 10)
  const end = new Date(year, month + 1, 0).toISOString().slice(0, 10)
  return { period_start: start, period_end: end }
}

// ---------------------------------------------------------------------------
// Admin: list all users with their credit rows
// ---------------------------------------------------------------------------

export async function listAiCreditLimits(): Promise<AiCreditLimit[]> {
  await requireRole(["main_admin"])
  const admin = createAdminClient()

  // Fetch all profiles
  const { data: profiles, error: profErr } = await admin
    .from("profiles")
    .select("id, email, full_name, role, team_id")
    .order("full_name", { ascending: true })

  if (profErr || !profiles) return []

  // Fetch all credit limit rows
  const { data: credits } = await admin
    .from("ai_credit_limits")
    .select("*")

  // Fetch teams for name lookup
  const { data: teams } = await admin
    .from("teams")
    .select("id, name")

  const teamMap = new Map((teams ?? []).map((t: any) => [t.id, t.name]))
  const creditMap = new Map((credits ?? []).map((c: any) => [c.user_id, c]))

  return profiles.map((p: any) => {
    const credit = creditMap.get(p.id)
    const bounds = computePeriodBounds("monthly")
    return {
      id: credit?.id ?? "",
      user_id: p.id,
      monthly_limit: credit?.monthly_limit ?? 100,
      used_this_period: credit?.used_this_period ?? 0,
      period_type: (credit?.period_type ?? "monthly") as AiCreditPeriod,
      period_start: credit?.period_start ?? bounds.period_start,
      period_end: credit?.period_end ?? bounds.period_end,
      is_unlimited: credit?.is_unlimited ?? (p.role === "main_admin"),
      notes: credit?.notes ?? null,
      updated_by: credit?.updated_by ?? null,
      created_at: credit?.created_at ?? new Date().toISOString(),
      updated_at: credit?.updated_at ?? new Date().toISOString(),
      user_email: p.email,
      user_full_name: p.full_name,
      user_role: p.role,
      user_team_name: p.team_id ? (teamMap.get(p.team_id) ?? null) : null,
      user_team_id: p.team_id ?? null,
    } as AiCreditLimit
  })
}

// ---------------------------------------------------------------------------
// Admin: create or update a single user's credit limit
// ---------------------------------------------------------------------------

const UpsertSchema = z.object({
  userId: z.string().uuid(),
  limit: z.number().int().min(0).max(999999),
  periodType: z.enum(["daily", "weekly", "monthly"]),
  isUnlimited: z.boolean(),
  notes: z.string().max(500).optional(),
})

export async function upsertCreditLimit(
  data: z.infer<typeof UpsertSchema>
): Promise<{ ok: boolean; error?: string }> {
  const actor = await requireRole(["main_admin"])
  const parsed = UpsertSchema.safeParse(data)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message }

  const { userId, limit, periodType, isUnlimited, notes } = parsed.data
  const bounds = computePeriodBounds(periodType)
  const admin = createAdminClient()

  const { error } = await admin.from("ai_credit_limits").upsert(
    {
      user_id: userId,
      monthly_limit: limit,
      period_type: periodType,
      is_unlimited: isUnlimited,
      notes: notes ?? null,
      updated_by: actor.id,
      period_start: bounds.period_start,
      period_end: bounds.period_end,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  )

  if (error) return { ok: false, error: error.message }

  await logActivity({
    actorId: actor.id,
    teamId: null,
    action: "ai_credits.updated",
    entityType: "ai_credit_limits",
    entityId: userId,
    metadata: { limit, periodType, isUnlimited },
  })

  revalidatePath("/dashboard/ai-usage")
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Admin: manually reset a user's usage counter to 0
// ---------------------------------------------------------------------------

export async function resetUserCredits(
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const actor = await requireRole(["main_admin"])
  if (!userId) return { ok: false, error: "Invalid user ID" }

  const admin = createAdminClient()
  const bounds = computePeriodBounds("monthly") // default; actual period_type preserved in DB

  // Fetch existing to get the correct period type
  const { data: existing } = await admin
    .from("ai_credit_limits")
    .select("period_type")
    .eq("user_id", userId)
    .maybeSingle()

  const periodType: AiCreditPeriod = (existing?.period_type as AiCreditPeriod) ?? "monthly"
  const newBounds = computePeriodBounds(periodType)

  const { error } = await admin
    .from("ai_credit_limits")
    .update({
      used_this_period: 0,
      period_start: newBounds.period_start,
      period_end: newBounds.period_end,
      updated_at: new Date().toISOString(),
      updated_by: actor.id,
    })
    .eq("user_id", userId)

  if (error) {
    // If no row exists, create one with defaults
    await admin.from("ai_credit_limits").insert({
      user_id: userId,
      monthly_limit: 100,
      used_this_period: 0,
      period_type: "monthly",
      ...bounds,
      updated_by: actor.id,
    })
  }

  await logActivity({
    actorId: actor.id,
    teamId: null,
    action: "ai_credits.reset",
    entityType: "ai_credit_limits",
    entityId: userId,
    metadata: {},
  })

  revalidatePath("/dashboard/ai-usage")
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Admin: bulk-set a default limit for all users who have NO credit row
// ---------------------------------------------------------------------------

const BulkSchema = z.object({
  limit: z.number().int().min(1).max(999999),
  periodType: z.enum(["daily", "weekly", "monthly"]),
})

export async function bulkSetDefaultLimit(
  data: z.infer<typeof BulkSchema>
): Promise<{ ok: boolean; inserted: number; error?: string }> {
  const actor = await requireRole(["main_admin"])
  const parsed = BulkSchema.safeParse(data)
  if (!parsed.success) return { ok: false, inserted: 0, error: parsed.error.issues[0]?.message }

  const { limit, periodType } = parsed.data
  const admin = createAdminClient()

  // Get all profile IDs
  const { data: profiles } = await admin.from("profiles").select("id, role")
  if (!profiles) return { ok: false, inserted: 0, error: "Could not fetch profiles" }

  // Get existing credit user IDs
  const { data: existing } = await admin.from("ai_credit_limits").select("user_id")
  const existingIds = new Set((existing ?? []).map((r: any) => r.user_id))

  const toInsert = profiles
    .filter((p: any) => !existingIds.has(p.id))
    .map((p: any) => {
      const bounds = computePeriodBounds(periodType)
      return {
        user_id: p.id,
        monthly_limit: limit,
        used_this_period: 0,
        period_type: periodType,
        is_unlimited: p.role === "main_admin",
        updated_by: actor.id,
        ...bounds,
      }
    })

  if (toInsert.length === 0) return { ok: true, inserted: 0 }

  const { error } = await admin.from("ai_credit_limits").insert(toInsert)
  if (error) return { ok: false, inserted: 0, error: error.message }

  await logActivity({
    actorId: actor.id,
    teamId: null,
    action: "ai_credits.bulk_set",
    entityType: "ai_credit_limits",
    entityId: null,
    metadata: { limit, periodType, count: toInsert.length },
  })

  revalidatePath("/dashboard/ai-usage")
  return { ok: true, inserted: toInsert.length }
}

// ---------------------------------------------------------------------------
// Admin: get per-user usage history (message log)
// ---------------------------------------------------------------------------

export async function getUserUsageHistory(
  userId: string,
  days = 30
): Promise<AiUsageLogEntry[]> {
  await requireRole(["main_admin"])
  const admin = createAdminClient()

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await admin
    .from("ai_usage_log")
    .select("*")
    .eq("user_id", userId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500)

  if (error || !data) return []

  // Get user info
  const { data: profile } = await admin
    .from("profiles")
    .select("email, full_name")
    .eq("id", userId)
    .maybeSingle()

  return (data as any[]).map((row) => ({
    ...row,
    user_email: profile?.email,
    user_full_name: profile?.full_name ?? null,
  })) as AiUsageLogEntry[]
}

// ---------------------------------------------------------------------------
// Admin: system-wide daily usage trend for the overview chart
// ---------------------------------------------------------------------------

export async function getSystemUsageTrend(days = 30): Promise<
  Array<{ day: string; count: number }>
> {
  await requireRole(["main_admin"])
  const admin = createAdminClient()

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await admin
    .from("ai_usage_log")
    .select("created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: true })

  if (!data) return []

  const buckets = new Map<string, number>()
  for (const row of data as any[]) {
    const day = (row.created_at as string).slice(0, 10)
    buckets.set(day, (buckets.get(day) ?? 0) + 1)
  }

  // Fill all days including zeros
  const out: Array<{ day: string; count: number }> = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
    const key = d.toISOString().slice(0, 10)
    out.push({ day: key, count: buckets.get(key) ?? 0 })
  }
  return out
}

// ---------------------------------------------------------------------------
// Admin: per-user daily trend (for track record panel chart)
// ---------------------------------------------------------------------------

export async function getUserDailyTrend(
  userId: string,
  days = 30
): Promise<Array<{ day: string; count: number }>> {
  await requireRole(["main_admin"])
  const admin = createAdminClient()

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await admin
    .from("ai_usage_log")
    .select("created_at")
    .eq("user_id", userId)
    .gte("created_at", since)

  if (!data) return []

  const buckets = new Map<string, number>()
  for (const row of data as any[]) {
    const day = (row.created_at as string).slice(0, 10)
    buckets.set(day, (buckets.get(day) ?? 0) + 1)
  }

  const out: Array<{ day: string; count: number }> = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
    const key = d.toISOString().slice(0, 10)
    out.push({ day: key, count: buckets.get(key) ?? 0 })
  }
  return out
}

// ---------------------------------------------------------------------------
// Any authenticated user: get MY credit status (for badge + chat enforcement)
// ---------------------------------------------------------------------------

export async function getMyCredits(): Promise<{
  used: number
  limit: number
  remaining: number
  periodType: AiCreditPeriod
  periodEnd: string
  isUnlimited: boolean
} | null> {
  const profile = await requireProfile()
  const supabase = await createClient()

  const { data } = await supabase
    .from("ai_credit_limits")
    .select("*")
    .eq("user_id", profile.id)
    .maybeSingle()

  if (!data) {
    // No row yet — return a sensible default (treated as unlimited until admin sets a limit)
    return null
  }

  const row = data as any
  const used = row.used_this_period ?? 0
  const limit = row.monthly_limit ?? 100
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    periodType: row.period_type as AiCreditPeriod,
    periodEnd: row.period_end,
    isUnlimited: row.is_unlimited ?? false,
  }
}
