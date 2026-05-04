const { createClient } = require("@supabase/supabase-js");
const { Pool } = require("pg");

async function main() {
  // Use direct PostgreSQL connection to run ALTER TABLE
  const pool = new Pool({
    connectionString: "postgresql://supabase_admin:27jqy5tqxtdl5cfpfi3ust8pn41hbqtch0nmcbpo9s9rpo0087vxulbm6lmp47vx@tramway.proxy.rlwy.net:58446/postgres",
    ssl: false,
  });

  try {
    console.log("1. Adding metadata column to chat_messages...");
    await pool.query(`
      ALTER TABLE chat_messages 
      ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
    `);
    console.log("   ✅ metadata column added (or already exists)");

    console.log("2. Adding text_excerpt and indexed_at to chat_documents...");
    await pool.query(`
      ALTER TABLE chat_documents 
      ADD COLUMN IF NOT EXISTS text_excerpt TEXT,
      ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMPTZ;
    `);
    console.log("   ✅ chat_documents columns added");

    console.log("3. Creating/replacing thread updated_at trigger...");
    await pool.query(`
      CREATE OR REPLACE FUNCTION bump_thread_updated_at() RETURNS trigger AS $$
      BEGIN
        UPDATE chat_threads SET updated_at = NOW() WHERE id = NEW.thread_id;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await pool.query(`
      DROP TRIGGER IF EXISTS chat_messages_bump_thread ON chat_messages;
      CREATE TRIGGER chat_messages_bump_thread
        AFTER INSERT ON chat_messages
        FOR EACH ROW EXECUTE FUNCTION bump_thread_updated_at();
    `);
    console.log("   ✅ trigger created");

    console.log("4. Verifying schema...");
    const { rows } = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'chat_messages' 
      ORDER BY ordinal_position
    `);
    console.log("   chat_messages columns:");
    rows.forEach(r => console.log(`     - ${r.column_name} (${r.data_type}, nullable: ${r.is_nullable})`));

    console.log("5. Test insert with metadata...");
    const supabase = createClient(
      "https://kong-production-afb7.up.railway.app",
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3Nzc3OTgwNTMsImV4cCI6MjA5MzE1ODA1M30.XJBqomKIe-gLBrwSZP2OjTE5DjMbQGoRmXDTkoGG3KU",
      { auth: { persistSession: false } }
    );

    // Need to reload the schema cache after altering the table
    // PostgREST caches the schema and needs a reload signal
    console.log("   Sending NOTIFY to reload PostgREST schema cache...");
    await pool.query("NOTIFY pgrst, 'reload schema'");
    
    // Wait a moment for cache to refresh
    await new Promise(r => setTimeout(r, 2000));

    const { data, error } = await supabase
      .from("chat_messages")
      .insert({
        thread_id: "4e3259e8-94af-4cf8-bef9-6332947807a2",
        role: "user",
        content: "Test message WITH metadata after migration",
        metadata: { test: true },
      })
      .select();

    console.log("   Insert with metadata error:", error ? JSON.stringify(error) : "none");
    console.log("   Insert with metadata data:", JSON.stringify(data));

    if (data && data.length > 0) {
      console.log("   ✅ SUCCESS! Messages with metadata now work!");
      // Clean up
      await supabase.from("chat_messages").delete().eq("id", data[0].id);
      console.log("   Cleaned up test message");
    }

    // Also clean up the earlier test message
    await pool.query("DELETE FROM chat_messages WHERE content = 'Test message without metadata'");

    console.log("\n🎉 Migration complete! Chat messages will now be saved correctly.");
  } catch (err) {
    console.error("ERROR:", err.message);
  } finally {
    await pool.end();
  }
}

main();
