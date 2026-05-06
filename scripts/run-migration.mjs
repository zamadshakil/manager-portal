import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString:
    process.env.POSTGRES_URL ||
    "postgresql://supabase_admin:27jqy5tqxtdl5cfpfi3ust8pn41hbqtch0nmcbpo9s9rpo0087vxulbm6lmp47vx@tramway.proxy.rlwy.net:58446/postgres",
  ssl: false,
});

try {
  await pool.query(
    "ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ"
  );
  console.log("✅ expires_at column added to materials");

  await pool.query(
    "CREATE INDEX IF NOT EXISTS materials_expires_idx ON public.materials(expires_at) WHERE expires_at IS NOT NULL"
  );
  console.log("✅ index created");

  await pool.query("NOTIFY pgrst, 'reload schema'");
  console.log("✅ PostgREST schema cache reloaded");

  // Also add expires_at to announcements if missing
  await pool.query(
    "ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ"
  );
  console.log("✅ expires_at column added to announcements");

  console.log("\n🎉 Migration complete!");
} catch (e) {
  console.error("❌ FAILED:", e.message);
  process.exit(1);
} finally {
  await pool.end();
}
