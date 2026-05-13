// One-shot runner for
// supabase/migrations/20260525_submissions_select_visibility_fix.sql
//
// Loads .env.local (DATABASE_URL / SUPABASE_DB_URL), applies the migration in
// a single transaction, records it in public._app_migrations (so the boot-time
// runner won't re-apply it), and reloads the PostgREST schema cache.
//
// Usage:  node scripts/run-submissions-select-visibility-fix.mjs

import pg from "pg"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const { Client } = pg
const __dirname = dirname(fileURLToPath(import.meta.url))

function loadEnvLocal() {
  try {
    const raw = readFileSync(join(__dirname, "../.env.local"), "utf8")
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
      if (!m) continue
      const [, k, vRaw] = m
      if (process.env[k]) continue
      process.env[k] = vRaw.replace(/^['"]|['"]$/g, "")
    }
  } catch {
    /* no .env.local — rely on shell env */
  }
}
loadEnvLocal()

const FILENAME = "20260525_submissions_select_visibility_fix.sql"
const SQL_PATH = join(__dirname, "..", "supabase", "migrations", FILENAME)

const connectionString =
  process.env.SUPABASE_DB_URL ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL

if (!connectionString) {
  console.error(
    "❌ No DB URL found. Set SUPABASE_DB_URL or DATABASE_URL in .env.local.",
  )
  process.exit(1)
}

const sql = readFileSync(SQL_PATH, "utf8")

const client = new Client({
  connectionString,
  ssl: false,
  connectionTimeoutMillis: 15_000,
  statement_timeout: 60_000,
})

try {
  await client.connect()

  await client.query(`
    CREATE TABLE IF NOT EXISTS public._app_migrations (
      filename   TEXT        PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  const { rowCount } = await client.query(
    "SELECT 1 FROM public._app_migrations WHERE filename = $1",
    [FILENAME],
  )
  if (rowCount > 0) {
    console.log(`ℹ️  ${FILENAME} already recorded as applied — nothing to do.`)
    process.exit(0)
  }

  console.log(`⏳ Applying ${FILENAME} …`)
  await client.query("BEGIN")
  try {
    await client.query(sql)
    await client.query(
      "INSERT INTO public._app_migrations(filename) VALUES($1) ON CONFLICT DO NOTHING",
      [FILENAME],
    )
    await client.query("COMMIT")
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    throw err
  }
  console.log(`✅ ${FILENAME} applied`)

  // Sanity check: confirm the policy exists and references submissions.update.
  const policy = await client.query(
    `SELECT polname,
            pg_get_expr(polqual, polrelid) AS using_expr
       FROM pg_policy
      WHERE polname = 'submissions_select'
        AND polrelid = 'public.submissions'::regclass`,
  )
  if (policy.rowCount === 0) {
    console.warn("⚠️  submissions_select policy not found after migration.")
  } else {
    const expr = policy.rows[0].using_expr || ""
    const mentionsUpdate = expr.includes("submissions.update")
    const mentionsDelete = expr.includes("submissions.delete")
    console.log(
      `   submissions_select USING references submissions.update=${mentionsUpdate} submissions.delete=${mentionsDelete}`,
    )
    if (mentionsDelete) {
      console.warn(
        "⚠️  Policy still mentions submissions.delete — review the migration output.",
      )
    }
  }

  await client.query("NOTIFY pgrst, 'reload schema'")
  console.log("✅ PostgREST schema cache reloaded")
  console.log("\n🎉 Done.")
} catch (e) {
  console.error("❌ Migration FAILED:", e.message)
  process.exit(1)
} finally {
  await client.end().catch(() => {})
}
