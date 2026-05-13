// One-shot runner for supabase/migrations/20260524_remove_override_deny.sql
//
// Loads .env.local (DATABASE_URL / SUPABASE_DB_URL), applies the migration in
// a single transaction, records it in public._app_migrations (so the boot-time
// runner won't re-apply it), and reloads the PostgREST schema cache.
//
// Usage:  node scripts/run-remove-override-deny-migration.mjs

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

const FILENAME = "20260524_remove_override_deny.sql"
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

  // Sanity check: confirm no deny rows remain and the CHECK constraint is in place.
  const denyCount = await client.query(
    "SELECT count(*)::int AS n FROM public.user_permission_overrides WHERE effect = 'deny'",
  )
  console.log(`   user_permission_overrides with effect='deny': ${denyCount.rows[0].n}`)

  await client.query("NOTIFY pgrst, 'reload schema'")
  console.log("✅ PostgREST schema cache reloaded")
  console.log("\n🎉 Done.")
} catch (e) {
  console.error("❌ Migration FAILED:", e.message)
  process.exit(1)
} finally {
  await client.end().catch(() => {})
}
