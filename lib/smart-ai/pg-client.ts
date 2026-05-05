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

function resolveConnectionString(): string {
  return (
    process.env.SUPABASE_DB_URL ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_PRISMA_URL ??
    ""
  )
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

export function isDirectPgConfigured(): boolean {
  return resolveConnectionString().length > 0
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
