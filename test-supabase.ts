import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";

const projectDir = process.cwd()
loadEnvConfig(projectDir)

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const userId = "fde2b4ec-7f7f-4a6b-a5a2-7138dd19b874"; // The team member
  
  const { data: newRow, error: insErr } = await supabase
    .from("ai_credit_limits")
    .insert({
      user_id: userId,
      monthly_limit: 100,
      used_this_period: 0,
      period_type: "monthly",
      is_unlimited: false
    })
    .select()
    .maybeSingle()

  console.log("Insert result:", newRow, insErr);
  
  const { error: rpcErr } = await supabase.rpc("increment_ai_usage", { p_user_id: userId });
  console.log("RPC result:", rpcErr);

  const { data: getRow } = await supabase.from("ai_credit_limits").select("used_this_period").eq("user_id", userId).maybeSingle();
  console.log("After RPC:", getRow);
  
  // Cleanup
  await supabase.from("ai_credit_limits").delete().eq("user_id", userId);
}
main().catch(console.error);
