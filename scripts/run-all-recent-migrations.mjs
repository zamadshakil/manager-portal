// Apply all migrations from 20260514 onward that may not have been run yet.
// Each file is attempted independently; duplicate-object / already-applied
// errors are logged as warnings so one stale file doesn't abort the rest.
//
// Requires SUPABASE_DB_URL (or DATABASE_URL) in .env.local pointing at the
// Railway public TCP proxy for Postgres.
//
// Usage:  node scripts/run-all-recent-migrations.mjs
import pg from "pg";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Minimal .env.local loader ──────────────────────────────────────────────
function loadEnvLocal() {
  try {
    const raw = readFileSync(join(__dirname, "../.env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const [, k, vRaw] = m;
      if (process.env[k]) continue;
      process.env[k] = vRaw.replace(/^['"]|['"]$/g, "");
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

// ── Migration list — chronological order ──────────────────────────────────
// Covers everything from 20260514 onward.  Scripts with dedicated runners
// are included here too because they're all idempotent or handle conflicts
// gracefully (IF NOT EXISTS / CREATE OR REPLACE / DROP … IF EXISTS).
const FILES = [
  "20260514_archive_processing.sql",
  "20260514_system_observability.sql",
  "20260515_get_latest_thread_messages.sql",
  "20260515_messaging_conversation_controls.sql",
  "20260515_profiles_email_change_tracking_cols.sql",
  "20260516_messaging_clear_history.sql",
  "20260517_fix_department_member_count.sql",
  "20260517_fix_profiles_messaging_rls.sql",
  "20260517_messaging_single_reaction.sql",
  "20260517_permission_overrides_expiry.sql",
  "20260518_reaction_bumps_conversation.sql",
  "20260519_fix_member_task_visibility.sql",
  "20260519120000_messaging_realtime_consistency.sql",
  "20260520_auto_unhide_on_message.sql",
  "20260520_capability_rls_write_policies.sql",
  "20260521_validation_rule_type.sql",
  "20260520_remove_announcements_ai_analyze.sql",
  "20260520_remove_materials_update.sql",
  "20260520_remove_tasks_ai_analyze.sql",
  "20260520_remove_team_management_capabilities.sql",
];

// PostgreSQL error codes that indicate "already applied" — warn, don't abort.
const ALREADY_APPLIED_CODES = new Set([
  "42710", // duplicate_object  (policy / type / index already exists)
  "42701", // duplicate_column
  "42P07", // duplicate_table
  "42723", // duplicate_function
  "23505", // unique_violation   (rare: seed re-insert without ON CONFLICT)
]);

const pool = new Pool({ connectionString, ssl: false });
const failed = [];

for (const file of FILES) {
  const sql = readFileSync(
    join(__dirname, "../supabase/migrations", file),
    "utf8",
  );
  process.stdout.write(`⏳ ${file} … `);
  try {
    await pool.query(sql);
    console.log("✅");
  } catch (e) {
    if (ALREADY_APPLIED_CODES.has(e.code)) {
      console.log(`⚠️  already applied (${e.code}: ${e.message.split("\n")[0]})`);
    } else {
      console.log(`❌ FAILED`);
      console.error(`   ${e.message.split("\n")[0]}`);
      failed.push({ file, error: e.message.split("\n")[0] });
    }
  }
}

// Always reload the PostgREST schema cache after bulk migrations.
try {
  await pool.query("NOTIFY pgrst, 'reload schema'");
  console.log("\n✅ PostgREST schema cache reloaded");
} catch (e) {
  console.error("\n⚠️  NOTIFY pgrst failed:", e.message);
}

await pool.end();

if (failed.length === 0) {
  console.log("\n🎉 All recent migrations applied successfully.");
} else {
  console.log(`\n⚠️  ${failed.length} migration(s) had unexpected errors:`);
  for (const { file, error } of failed) {
    console.log(`   • ${file}: ${error}`);
  }
  console.log("\nReview the errors above and apply those files manually via Supabase Studio if needed.");
  process.exit(1);
}
