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

// The original project kept its foundational schema outside the dated
// migration directory. Bootstrap those files only for a genuinely empty
// database; established installations must never replay them.
const FOUNDATION_FILES = [
  "001_init_schema.sql",
  "002_helper_functions.sql",
  "003_rls_policies.sql",
  "005_tasks_and_late_submissions.sql",
  "006_expiration_for_materials.sql",
  "006_security_hardening_and_indexes.sql",
  "007_rule_ids_and_delete_policy.sql",
  "008_fix_manager_auth.sql",
  "009_assign_managers_to_tasks.sql",
  "009_security_fixes.sql",
]

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

    const core = await client.query<{ profiles: string | null }>(
      "SELECT to_regclass('public.profiles')::text AS profiles",
    )
    if (!core.rows[0]?.profiles) {
      const foundationDir = path.join(process.cwd(), "scripts")
      console.log("[migrations] empty database detected — applying foundation")
      for (const file of FOUNDATION_FILES) {
        const sql = fs.readFileSync(path.join(foundationDir, file), "utf-8")
        try {
          await client.query("BEGIN")
          await client.query(sql)
          await client.query(
            "INSERT INTO public._app_migrations(filename) VALUES($1) ON CONFLICT DO NOTHING",
            [`foundation/${file}`],
          )
          await client.query("COMMIT")
          console.log(`[migrations] ✓ foundation/${file}`)
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {})
          throw new Error(`foundation/${file}: ${(err as Error).message}`)
        }
      }
    }

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
    if (failed > 0 && process.env.MIGRATIONS_STRICT === "true") {
      throw new Error(`${failed} database migration(s) failed in strict mode`)
    }
  } catch (err) {
    console.error("[migrations] runner failed to start:", (err as Error).message)
    if (process.env.MIGRATIONS_STRICT === "true") throw err
  } finally {
    await client.end().catch(() => {})
  }
}
