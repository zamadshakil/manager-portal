import "server-only"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/supabase/database.types"
import { getSupabaseEnv } from "@/lib/env"

/**
 * Service-role client. Bypasses RLS. Use only on the server, only in routes
 * that have already authorized the caller (Main Admin or Manager actions, plus
 * the validation pipeline that needs to write validation_runs and update
 * submissions).
 *
 * After the Railway migration the URL points at Kong and the service-role
 * key is the new JWT signed by the self-hosted GoTrue JWT_SECRET.
 */
let cached: SupabaseClient<Database> | null = null

export function createAdminClient(): SupabaseClient<Database> {
  if (cached) return cached
  const env = getSupabaseEnv()
  if (!env.url || !env.serviceRoleKey) {
    const missing: string[] = []
    if (!env.url) missing.push("NEXT_PUBLIC_SUPABASE_URL")
    if (!env.serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY")
    throw new Error(
      `Supabase service-role client is not configured (missing ${missing.join(", ")}).`,
    )
  }
  cached = createClient<Database>(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cached
}
