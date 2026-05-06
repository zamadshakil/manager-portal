import { createAdminClient } from "../lib/supabase/admin";

async function check() {
  const admin = createAdminClient();
  const { data: logs, error: logsErr } = await admin.from('ai_usage_log').select('*').limit(5);
  console.log("Logs:", logs);
  console.log("Logs Error:", logsErr);

  const { data: trend } = await admin.from('ai_usage_log').select('created_at, credits_deducted');
  console.log("Trend Data Count:", trend?.length);
  
  const { data: limits } = await admin.from('ai_credit_limits').select('*');
  console.log("Limits:", limits?.map(l => ({ user_id: l.user_id, used: l.used_this_period })));
}

check();
