// Apply the validation_rule_type migration to the self-hosted Supabase Postgres
// and reload the PostgREST schema cache.
//
// Requires SUPABASE_DB_URL (or DATABASE_URL) in .env.local pointing at the
// Railway public TCP proxy for Postgres.
//
// Usage:  node scripts/run-validation-rule-type-migration.mjs
import pg from "pg";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

// Minimal .env.local loader so we don't add a dotenv dep.
function loadEnvLocal() {
  try {
    const raw = readFileSync(join(__dirname, "../.env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const [, k, vRaw] = m;
      if (process.env[k]) continue;
      const v = vRaw.replace(/^['"]|['"]$/g, "");
      process.env[k] = v;
    }
  } catch { /* no .env.local — rely on shell env */ }
}
loadEnvLocal();

const connectionString =
  process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

if (!connectionString) {
  console.error(
    "❌ Set SUPABASE_DB_URL or DATABASE_URL in .env.local (see .env.local.example).",
  );
  process.exit(1);
}

const MIGRATION = "20260521_validation_rule_type.sql";

const pool = new Pool({ connectionString, ssl: false });

try {
  const sql = readFileSync(
    join(__dirname, "../supabase/migrations", MIGRATION),
    "utf8",
  );

  console.log(`⏳ Applying ${MIGRATION} …`);
  await pool.query(sql);
  console.log(`✅ ${MIGRATION} applied`);

  await pool.query("NOTIFY pgrst, 'reload schema'");
  console.log("✅ PostgREST schema cache reloaded");

  console.log("\n🎉 Done — validation_rules.rule_type column is live.");
} catch (e) {
  console.error("❌ Migration FAILED:", e.message);
  process.exit(1);
} finally {
  await pool.end();
}
