import pg from "pg";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const { Pool } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));

const pool = new Pool({
  connectionString:
    process.env.SUPABASE_DB_URL ||
    process.env.DATABASE_URL ||
    "postgresql://supabase_admin:27jqy5tqxtdl5cfpfi3ust8pn41hbqtch0nmcbpo9s9rpo0087vxulbm6lmp47vx@tramway.proxy.rlwy.net:58446/postgres",
  ssl: false,
});

const sql = readFileSync(
  join(__dirname, "../supabase/migrations/20260520_capability_rls_write_policies.sql"),
  "utf8"
);

try {
  console.log("⏳ Applying capability-aware RLS write policies…");
  await pool.query(sql);
  console.log("✅ announcements_write   — capability-granted members can create/delete team announcements");
  console.log("✅ materials_write       — capability-granted members can create/delete team materials");
  console.log("✅ tasks_select          — capability-granted members can read their team's tasks");
  console.log("✅ tasks_write           — capability-granted members can create/delete team tasks");
  console.log("✅ submissions_select    — capability-granted members can read team submissions");
  console.log("✅ submissions_update    — capability-granted members can update team submissions");
  console.log("✅ submissions_delete    — capability-granted members can delete team submissions");

  console.log("\n🎉 Migration complete! Capability-based RLS is now active.");
} catch (e) {
  console.error("❌ Migration FAILED:", e.message);
  process.exit(1);
} finally {
  await pool.end();
}
