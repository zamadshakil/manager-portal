import { createClient } from "@supabase/supabase-js"

/**
 * Service-role client. Bypasses RLS. Use only on the server, only in routes
 * that have already authorized the caller (Main Admin or Manager actions, plus
 * the validation pipeline that needs to write validation_runs and update
 * submissions).
 */
let cached: ReturnType<typeof createClient> | null = null

export function createAdminClient() {
  if (cached) return cached
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error("Supabase service role credentials are not configured.")
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cached
}
