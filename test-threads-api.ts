import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

async function main() {
  // Mock the requireProfile and req
  // Let's just run the DB queries exactly as the API does.
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const profileId = "fde2b4ec-7f7f-4a6b-a5a2-7138dd19b874";
  
  const { data: threads } = await supabase
    .from("chat_threads")
    .select("id, title, created_at, updated_at")
    .eq("user_id", profileId)
    .order("updated_at", { ascending: false })
    .limit(50);
    
  if (!threads) return console.log("No threads");
  const threadIds = threads.map(t => t.id);

  const [lastMsgsResult, countsResult] = await Promise.all([
    supabase.rpc("get_latest_thread_messages", { thread_ids: threadIds }).then(res => res, () => null),
    supabase.from("chat_messages").select("thread_id", { count: "exact", head: false }).in("thread_id", threadIds),
  ]);

  const lastMsgMap = new Map();
  const countMap = new Map();

  if (lastMsgsResult?.data) {
    for (const row of lastMsgsResult.data) {
      lastMsgMap.set(row.thread_id, { role: row.role, content: row.content });
    }
  } else {
    // fallback
  }

  if (countsResult?.data) {
    const grouped = {};
    for (const row of countsResult.data) {
      grouped[row.thread_id] = (grouped[row.thread_id] || 0) + 1;
    }
    for (const [tid, count] of Object.entries(grouped)) {
      countMap.set(tid, count);
    }
  }

  const threadsWithPreview = threads.map((thread) => ({
    id: thread.id,
    title: thread.title,
    message_count: countMap.get(thread.id) ?? 0,
    last_message: lastMsgMap.get(thread.id) ?? null,
  }));

  const nonEmpty = threadsWithPreview.filter((t) => t.message_count > 0);
  console.log("Returned Threads:", JSON.stringify(nonEmpty, null, 2));
}

main().catch(console.error);
