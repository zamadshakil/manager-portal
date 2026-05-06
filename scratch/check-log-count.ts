import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function check() {
  if (!url || !key) {
    console.error("Missing env vars");
    return;
  }
  const admin = createClient(url, key);
  const { count, error } = await admin.from('ai_usage_log').select('*', { count: 'exact', head: true });
  console.log("Total log rows:", count);
  if (error) console.error("Error counting logs:", error);

  const { data: samples } = await admin.from('ai_usage_log').select('created_at').limit(5);
  console.log("Sample created_at values:", samples);
}

check();
