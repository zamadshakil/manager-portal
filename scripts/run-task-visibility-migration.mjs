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
  join(__dirname, "../supabase/migrations/20260519_fix_member_task_visibility.sql"),
  "utf8"
);

try {
  console.log("⏳ Applying task visibility RLS fix…");
  await pool.query(sql);
  console.log("✅ tasks_select policy updated — members now only see assigned tasks");

  await pool.query("NOTIFY pgrst, 'reload schema'");
  console.log("✅ PostgREST schema cache reloaded");

  console.log("\n🎉 Migration complete!");
} catch (e) {
  console.error("❌ Migration FAILED:", e.message);
  process.exit(1);
} finally {
  await pool.end();
}
