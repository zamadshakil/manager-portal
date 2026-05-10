/**
 * Startup migration runner.
 *
 * Connects to Postgres directly (bypassing PostgREST/Kong) and applies any
 * .sql files in supabase/migrations/ that have not yet been recorded in the
 * public._app_migrations tracking table.
 *
 * Activated via instrumentation.ts when RUN_MIGRATIONS_ON_BOOT=true.
 *
 * Design notes:
 *  - Each file runs in its own transaction; a failure rolls back that file
 *    only and does NOT crash the app — the remaining files are still attempted.
 *  - Files are applied in lexicographic order (matches date-prefixed filenames).
 *  - Safe to run concurrently: the CREATE TABLE uses IF NOT EXISTS and the
 *    INSERT uses ON CONFLICT DO NOTHING.
 *  - Path resolution: reads from process.cwd()/supabase/migrations so it
 *    works in both dev (project root) and standalone production build
 *    (after postbuild copies the folder alongside server.js).
 */

import { Client } from "pg"
import fs from "node:fs"
import path from "node:path"

const TRACKING_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS public._app_migrations (
    filename   TEXT        PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`

export async function runMigrations(): Promise<void> {
  const url =
    process.env.POSTGRES_PRIVATE_URL ??
    process.env.SUPABASE_DB_URL ??
    process.env.DATABASE_URL

  if (!url) {
    console.warn("[migrations] no DB URL found (SUPABASE_DB_URL / POSTGRES_PRIVATE_URL) — skipping")
    return
  }

  const migrationsDir = path.join(process.cwd(), "supabase", "migrations")

  if (!fs.existsSync(migrationsDir)) {
    console.warn(`[migrations] directory not found at ${migrationsDir} — skipping`)
    return
  }

  const client = new Client({
    connectionString: url,
    ssl: url.includes("railway.internal") ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000,
    statement_timeout: 60_000,
  })

  try {
    await client.connect()

    await client.query(TRACKING_TABLE_DDL)

    const { rows } = await client.query<{ filename: string }>(
      "SELECT filename FROM public._app_migrations",
    )
    const applied = new Set(rows.map((r) => r.filename))

    const allFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort()

    const pending = allFiles.filter((f) => !applied.has(f))

    if (pending.length === 0) {
      console.log("[migrations] up-to-date")
      return
    }

    let succeeded = 0
    let failed = 0

    for (const file of pending) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8")
      try {
        await client.query("BEGIN")
        await client.query(sql)
        await client.query(
          "INSERT INTO public._app_migrations(filename) VALUES($1) ON CONFLICT DO NOTHING",
          [file],
        )
        await client.query("COMMIT")
        console.log(`[migrations] ✓ ${file}`)
        succeeded++
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {})
        console.error(`[migrations] ✗ ${file}:`, (err as Error).message)
        failed++
      }
    }

    console.log(
      `[migrations] done — ${succeeded} applied, ${failed} failed out of ${pending.length} pending`,
    )
  } catch (err) {
    console.error("[migrations] runner failed to start:", (err as Error).message)
  } finally {
    await client.end().catch(() => {})
  }
}
