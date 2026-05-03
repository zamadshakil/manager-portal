import { createBrowserClient } from "@supabase/ssr"
import type { Database } from "@/lib/supabase/database.types"

/**
 * Browser-side Supabase client. Reads the same env vars as the server
 * client; on the client these are inlined at build time so a missing
 * value here means the production build was published without them.
 *
 * After the Railway migration both vars must point at the Kong gateway:
 *   NEXT_PUBLIC_SUPABASE_URL=https://kong-production-<id>.up.railway.app
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=<JWT signed by the self-hosted JWT_SECRET>
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error(
      "Supabase browser client is not configured. " +
        "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY on the manager-portal Railway service.",
    )
  }
  return createBrowserClient<Database>(url, anonKey)
}
