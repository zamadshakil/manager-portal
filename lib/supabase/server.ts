import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import type { Database } from "@/lib/supabase/database.types"
import { getSupabaseEnv, warnIfSupabaseUnconfigured } from "@/lib/env"

export async function createClient() {
  const cookieStore = await cookies()

  // After the Railway migration the portal points at the Kong gateway URL
  // and JWTs signed with the self-hosted GoTrue JWT_SECRET. If those env
  // vars are missing we throw a *targeted* error so server components and
  // server actions can surface a clear setup message instead of leaking
  // the upstream Supabase SDK's generic "URL and Key are required" stack.
  const env = getSupabaseEnv()
  if (!env.configured) {
    warnIfSupabaseUnconfigured("supabase/server.createClient")
    throw new Error(
      `Supabase is not configured (missing ${env.missing.join(", ")}). ` +
        `Set the Railway Kong URL and self-hosted JWT keys before requesting authenticated pages.`,
    )
  }

  return createServerClient<Database>(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // Called from a Server Component - safe to ignore.
        }
      },
    },
  })
}
