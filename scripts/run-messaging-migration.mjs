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
    // fallback to the same proxy URL used in run-migration.mjs
    "postgresql://supabase_admin:27jqy5tqxtdl5cfpfi3ust8pn41hbqtch0nmcbpo9s9rpo0087vxulbm6lmp47vx@tramway.proxy.rlwy.net:58446/postgres",
  ssl: false,
});

const sql = readFileSync(
  join(__dirname, "../supabase/migrations/20260508_messaging.sql"),
  "utf8"
);

try {
  console.log("⏳ Running messaging migration…");
  await pool.query(sql);
  console.log("✅ Tables, indexes, RLS, trigger, and RPC created");

  // Reload PostgREST schema cache — this is what fixes the
  // "Could not find the table in the schema cache" error.
  await pool.query("NOTIFY pgrst, 'reload schema'");
  console.log("✅ PostgREST schema cache reloaded");

  console.log("\n🎉 Messaging migration complete! You can now open DMs.");
} catch (e) {
  console.error("❌ Migration FAILED:", e.message);
  process.exit(1);
} finally {
  await pool.end();
}
