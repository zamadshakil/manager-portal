import "server-only"

/**
 * Direct Postgres connection for the RAG layer.
 *
 * Why this exists
 * ---------------
 * On the self-hosted Supabase stack on Railway, PostgREST (behind Kong) has
 * been serving stale schema-cache snapshots — e.g. it doesn't know about
 * `rag_documents.chunk_index` even after the column was added and
 * `NOTIFY pgrst, 'reload schema'` was issued. The symptom is:
 *
 *   POST /rag_documents → "Could not find the 'chunk_index' column of
 *                          'rag_documents' in the schema cache"
 *
 * Restarting the PostgREST container fixes it but is a manual, painful
 * step. Indexing through PostgREST also adds a Kong → PostgREST → Postgres
 * hop for every chunk insert.
 *
 * This module sidesteps both problems by talking to Postgres directly with
 * the `pg` driver. The connection string can come from any of:
 *
 *   - SUPABASE_DB_URL         (preferred, conventional name)
 *   - DATABASE_URL            (Railway Postgres plugin default)
 *   - POSTGRES_URL            (Vercel Postgres convention)
 *   - POSTGRES_PRISMA_URL     (also Vercel convention; pooled)
 *
 * On Railway the canonical internal value is something like:
 *   postgresql://postgres:<password>@postgres.railway.internal:5432/postgres
 *
 * Set whichever of those env vars you have on the manager-portal service.
 * If none are set, the indexer falls back to the Supabase RPC path.
 */

import { Pool, type QueryResult } from "pg"

declare global {
  // eslint-disable-next-line no-var
  var __ragPgPool: Pool | undefined
}

/**
 * Sanitise a raw env-var value before we hand it to `pg`.
 *
 * We've seen real-world Railway deployments where the env var contains
 * leftovers from the dashboard's template syntax (`${{Postgres.DATABASE_URL}}`)
 * — a stray `}` or `{` ends up in the value and the URL parser silently
 * pulls it into the database name, producing errors like:
 *
 *   database "postgres}" does not exist
 *
 * This function strips:
 *   - surrounding whitespace
 *   - wrapping single/double/back quotes
 *   - any leading/trailing `{` or `}` that leaked from `${{ ... }}` refs
 *   - a stray trailing `}` immediately after the database name segment
 *
 * It does NOT touch characters inside the password (which can legitimately
 * contain `{` and `}`). It only fixes the head and tail of the string.
 */
function sanitiseConnectionString(raw: string): string {
  let s = raw.trim()
  if (!s) return ""

  // Strip wrapping quotes if someone pasted the value with quotes.
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith("`") && s.endsWith("`"))
  ) {
    s = s.slice(1, -1).trim()
  }

  // Strip stray template-syntax leftovers at the head/tail.
  // Examples we've actually seen in production:
  //   "postgresql://...:5432/postgres}"   -> trailing `}` from `${{...}}`
  //   "{postgresql://...:5432/postgres"   -> leading `{`
  while (s.endsWith("}") || s.endsWith("{")) s = s.slice(0, -1)
  while (s.startsWith("{") || s.startsWith("}")) s = s.slice(1)

  return s.trim()
}

/**
 * Validate that the sanitised string looks like a usable Postgres URL,
 * and that the trailing database-name segment is sane (no stray braces,
 * spaces, etc.). If anything is off we throw a descriptive error so the
 * upload route surfaces it instead of failing deep inside `pg` with the
 * cryptic "database X does not exist".
 */
function assertValidPgUrl(s: string): void {
  if (!/^postgres(ql)?:\/\//i.test(s)) {
    throw new Error(
      `connection string does not start with postgres:// or postgresql:// — got: "${s.slice(0, 40)}…"`,
    )
  }

  let parsed: URL
  try {
    parsed = new URL(s)
  } catch (err: any) {
    throw new Error(`connection string is not a valid URL: ${err?.message ?? err}`)
  }

  // pathname looks like "/postgres" or "/mydb"
  const dbName = parsed.pathname.replace(/^\//, "")
  if (!dbName) {
    throw new Error("connection string is missing a database name (path segment)")
  }
  if (!/^[A-Za-z0-9_\-.]+$/.test(dbName)) {
    throw new Error(
      `database name "${dbName}" contains illegal characters (looks like template syntax leaked in — check Railway env var for stray { or } chars)`,
    )
  }
}

function resolveConnectionString(): string {
  const raw =
    process.env.SUPABASE_DB_URL ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_PRISMA_URL ??
    ""

  const cleaned = sanitiseConnectionString(raw)
  if (!cleaned) return ""

  // Loud warning if we had to scrub the input — helps the operator see
  // that their env var is malformed even though we recovered.
  if (cleaned !== raw.trim()) {
    console.warn(
      `[rag-pg] connection string contained stray characters (likely a leaked Railway template like \${{...}}); ` +
        `sanitised the value before connecting. Fix the env var in Railway → manager-portal → Variables.`,
    )
  }

  // Will throw with a helpful message if the URL is still malformed.
  assertValidPgUrl(cleaned)
  return cleaned
}

/**
 * Decide whether the connection requires TLS. Internal Railway hostnames
 * (`*.railway.internal`) are on a private network and don't need / accept
 * TLS. Public hostnames usually do, but managed providers commonly use
 * self-signed certs so we accept them by default.
 */
function shouldUseSsl(url: string): boolean {
  if (url.includes(".railway.internal")) return false
  if (url.includes("localhost") || url.includes("127.0.0.1")) return false
  // Honour an explicit override.
  if (process.env.PG_SSL === "false") return false
  if (process.env.PG_SSL === "true") return true
  return true
}

function getPool(): Pool | null {
  if (globalThis.__ragPgPool) return globalThis.__ragPgPool

  const url = resolveConnectionString()
  if (!url) return null

  const pool = new Pool({
    connectionString: url,
    ssl: shouldUseSsl(url) ? { rejectUnauthorized: false } : undefined,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "manager-portal-rag",
  })

  // Surface idle-client errors so they show up in Railway logs instead of
  // silently terminating the process.
  pool.on("error", (err) => {
    console.error("[rag-pg] idle client error:", err.message)
  })

  globalThis.__ragPgPool = pool
  return pool
}

/**
 * Predicate-style check: is *any* connection string env var set?
 * Does NOT throw on malformed values — that's `resolveConnectionString`'s
 * job, which is called later when we actually try to connect. We keep
 * this loose so the indexer still routes through the direct-pg branch
 * (which then reports the validation error to the user) instead of
 * silently falling back to RPC.
 */
export function isDirectPgConfigured(): boolean {
  const raw =
    process.env.SUPABASE_DB_URL ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_PRISMA_URL ??
    ""
  return sanitiseConnectionString(raw).length > 0
}

export async function pgQuery<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  const pool = getPool()
  if (!pool) throw new Error("direct pg not configured (set SUPABASE_DB_URL or DATABASE_URL)")
  return pool.query<T>(text, params as any[])
}

/**
 * Quick connectivity probe for the health endpoint. Returns the server
 * version string on success, throws otherwise.
 */
export async function pgPing(): Promise<string> {
  const res = await pgQuery<{ version: string }>("SELECT version() AS version")
  return res.rows[0]?.version ?? "unknown"
}

/**
 * Return a *safe* description of the configured connection string for
 * the health endpoint. Never returns the password. Used to debug
 * malformed env vars (stray braces from Railway template syntax,
 * wrong db name, etc.) without leaking secrets.
 */
export function describePgConfig(): {
  configured: boolean
  source?: "SUPABASE_DB_URL" | "DATABASE_URL" | "POSTGRES_URL" | "POSTGRES_PRISMA_URL"
  sanitised: boolean
  host?: string
  port?: string
  database?: string
  user?: string
  ssl?: boolean
  parseError?: string
} {
  const sources = [
    ["SUPABASE_DB_URL", process.env.SUPABASE_DB_URL],
    ["DATABASE_URL", process.env.DATABASE_URL],
    ["POSTGRES_URL", process.env.POSTGRES_URL],
    ["POSTGRES_PRISMA_URL", process.env.POSTGRES_PRISMA_URL],
  ] as const

  const found = sources.find(([, v]) => v && v.length > 0)
  if (!found) return { configured: false, sanitised: false }

  const [source, raw] = found
  const cleaned = sanitiseConnectionString(raw ?? "")
  const sanitised = cleaned !== (raw ?? "").trim()

  try {
    assertValidPgUrl(cleaned)
    const u = new URL(cleaned)
    return {
      configured: true,
      source,
      sanitised,
      host: u.hostname,
      port: u.port || "5432",
      database: u.pathname.replace(/^\//, ""),
      user: u.username,
      ssl: shouldUseSsl(cleaned),
    }
  } catch (err: any) {
    return {
      configured: true,
      source,
      sanitised,
      parseError: err?.message ?? String(err),
    }
  }
}
