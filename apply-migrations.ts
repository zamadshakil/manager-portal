import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import fs from "fs";
import path from "path";
import { Client } from "pg";

const projectDir = process.cwd()
loadEnvConfig(projectDir)

async function main() {
  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) {
    console.error("No POSTGRES_URL found");
    return;
  }
  
  const client = new Client({ connectionString });
  await client.connect();

  const files = [
    "20260506_ai_credits_setup.sql",
    "20260506_ai_usage_increment_rpc.sql"
  ];

  for (const file of files) {
    const filePath = path.join(projectDir, "supabase", "migrations", file);
    if (fs.existsSync(filePath)) {
      console.log(`Running ${file}...`);
      const sql = fs.readFileSync(filePath, "utf-8");
      try {
        await client.query(sql);
        console.log(`Successfully applied ${file}`);
      } catch (e) {
        console.error(`Failed to apply ${file}:`, e.message);
      }
    }
  }

  await client.end();
}

main().catch(console.error);
