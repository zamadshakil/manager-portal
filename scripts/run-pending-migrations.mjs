// Apply pending migrations to the self-hosted Supabase Postgres and
// reload the PostgREST schema cache.
//
// Requires DATABASE_URL (or SUPABASE_DB_URL) in env, pointing at the
// Railway public TCP proxy for Postgres.  See .env.local.example.
//
// Usage:  node scripts/run-pending-migrations.mjs
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
    "❌ Set SUPABASE_DB_URL or DATABASE_URL (see .env.local.example).",
  );
  process.exit(1);
}

const FILES = [
  // Adds profiles.deleted_at — required by 20260511 (get_conversation_previews)
  "20260508_profile_soft_delete.sql",
  // Adds find_or_create_dm RPC + hardens search_path on existing funcs
  "20260509_messaging_security_critical.sql",
  // ↑ 20260510 already applied successfully — skip to avoid re-running
  // Adds get_conversation_previews RPC (the function the API 500s on)
  "20260511_messaging_perf.sql",
  // UX improvements (read receipts, soft-delete, reactions)
  "20260512_messaging_ux.sql",
  // FIX: drops stale 1-param increment_ai_usage overload and creates the
  // correct 5-param version; also adds ledger columns to ai_usage_log.
  // Resolves: "Could not find the function public.increment_ai_usage
  // (p_credits, p_event_type, p_model, p_thread_id, p_user_id)"
  "20260513_fix_increment_ai_usage_rpc.sql",
];

const pool = new Pool({ connectionString, ssl: false });

try {
  for (const f of FILES) {
    const sql = readFileSync(
      join(__dirname, "../supabase/migrations", f),
      "utf8",
    );
    console.log(`⏳ Applying ${f} …`);
    await pool.query(sql);
    console.log(`✅ ${f}`);
  }

  await pool.query("NOTIFY pgrst, 'reload schema'");
  console.log("✅ PostgREST schema cache reloaded");
  console.log("\n🎉 Done. All pending migrations applied successfully.");
} catch (e) {
  console.error("❌ Migration FAILED:", e.message);
  process.exit(1);
} finally {
  await pool.end();
}
