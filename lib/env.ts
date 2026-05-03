/**
 * Centralized env-var access for Supabase + Smart AI services.
 *
 * The portal originally talked to managed Supabase. As of the Railway
 * migration it talks to a self-hosted Supabase stack that lives in the
 * same Railway project (Kong → Postgrest / GoTrue / Storage / Realtime
 * → Postgres + pgvector), plus two sibling services for Smart AI:
 *
 *   - mcp-service  (Node.js)  — chat orchestration over LangChain/LangGraph
 *   - rag-service  (FastAPI)  — pgvector retrieval + analytics
 *
 * The values themselves don't change — only their *origin*:
 *   - NEXT_PUBLIC_SUPABASE_URL    -> the Railway Kong public URL
 *   - NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are now JWTs
 *     signed with the self-hosted GoTrue JWT_SECRET (rotate from the managed
 *     keys on the day of cutover).
 *
 * This module is the *only* place that reads those vars and the *only*
 * place that decides what to do when they are missing. Every other module
 * imports the helpers below so we get one consistent, friendly failure mode
 * during deploys, key rotations, or local development without `.env.local`.
 */

type SupabaseEnv = {
  url: string
  anonKey: string
  serviceRoleKey: string | null
  configured: boolean
  /** Human-readable list of missing vars, for surfacing in UI / logs. */
  missing: string[]
}

let cached: SupabaseEnv | null = null

export function getSupabaseEnv(): SupabaseEnv {
  if (cached) return cached
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ""
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""

  const missing: string[] = []
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL")
  if (!anonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY")

  cached = {
    url,
    anonKey,
    serviceRoleKey: serviceRoleKey || null,
    configured: missing.length === 0,
    missing,
  }
  return cached
}

/**
 * Logs a one-time warning to the server console when Supabase env vars
 * are missing. Intentionally a `warn` rather than a throw so the dev
 * preview can still render a friendly setup state instead of crashing
 * the proxy on every request (which is what caused the recent 500s
 * after the Railway migration).
 */
let warned = false
export function warnIfSupabaseUnconfigured(context: string): void {
  const env = getSupabaseEnv()
  if (env.configured) return
  if (warned) return
  warned = true
  // Single grouped message — easy to spot in Railway logs.
  console.warn(
    `[supabase] ${context}: Supabase env vars are not set. ` +
      `Missing: ${env.missing.join(", ")}. ` +
      `After the Railway migration you must point these at the Kong ` +
      `public URL with new JWTs signed by the self-hosted JWT_SECRET. ` +
      `See .env.local.example for the full list.`,
  )
}
