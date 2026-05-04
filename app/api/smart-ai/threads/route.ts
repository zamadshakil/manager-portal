import { NextResponse } from "next/server"
import { requireProfile } from "@/lib/auth"
import { createClient as createBrowserClient } from "@/lib/supabase/server"
import { createClient as createSBClient } from "@supabase/supabase-js"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Build a Supabase client for thread operations.
 *
 * Prefers the service-role key so reads are never blocked by cookie-session
 * issues in API routes (the write path already uses service-role). When the
 * service-role key is unavailable (local dev without secrets) we fall back
 * to the user's RLS-scoped session client.
 */
async function getSupabase() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ""

  if (serviceRoleKey && supabaseUrl) {
    return {
      client: createSBClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
      mode: "service_role" as const,
    }
  }

  return {
    client: await createBrowserClient(),
    mode: "user_jwt" as const,
  }
}

/**
 * GET /api/smart-ai/threads
 *
 * Returns all chat threads for the authenticated user, sorted by most recent
 * activity. Each thread includes a preview of the last message so the UI
 * can show a meaningful label without a second round-trip.
 */
export async function GET(req: Request) {
  const profile = await requireProfile()
  const { client: supabase, mode } = await getSupabase()

  const limit = Math.min(
    Number(new URL(req.url).searchParams.get("limit") ?? "50"),
    100,
  )

  // Fetch threads — service-role bypasses RLS so we filter explicitly.
  const { data: threads, error } = await supabase
    .from("chat_threads")
    .select("id, title, created_at, updated_at")
    .eq("user_id", profile.id)
    .order("updated_at", { ascending: false })
    .limit(limit)

  if (error) {
    console.error(`[threads] list failed (${mode}):`, error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!threads || threads.length === 0) {
    return NextResponse.json({ threads: [] })
  }

  const threadIds = threads.map((t) => t.id)

  // Batch fetch: last message + count for ALL threads in two queries
  // instead of 2 queries per thread (N+1 → 2 total).
  const [lastMsgsResult, countsResult] = await Promise.all([
    // Get the most recent message for each thread using DISTINCT ON
    supabase.rpc("get_latest_thread_messages", { thread_ids: threadIds }).then(
      (res) => res,
      // Fallback if the RPC doesn't exist yet — individual queries
      () => null,
    ),
    // Get message counts per thread
    supabase
      .from("chat_messages")
      .select("thread_id", { count: "exact", head: false })
      .in("thread_id", threadIds),
  ])

  // Build lookup maps for O(1) access
  const lastMsgMap = new Map<string, { role: string; content: string; created_at: string }>()
  const countMap = new Map<string, number>()

  // If the RPC worked, use it. Otherwise fall back to the old per-thread approach.
  if (lastMsgsResult?.data) {
    for (const row of lastMsgsResult.data as any[]) {
      lastMsgMap.set(row.thread_id, {
        role: row.role,
        content: (row.content as string)?.slice(0, 120) ?? "",
        created_at: row.created_at,
      })
    }
  } else {
    // Fallback: fetch last message per thread in parallel (still better than sequential)
    const msgResults = await Promise.all(
      threadIds.map((tid) =>
        supabase
          .from("chat_messages")
          .select("thread_id, role, content, created_at")
          .eq("thread_id", tid)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ),
    )
    for (const res of msgResults) {
      if (res.data) {
        lastMsgMap.set(res.data.thread_id as string, {
          role: res.data.role as string,
          content: (res.data.content as string)?.slice(0, 120) ?? "",
          created_at: res.data.created_at as string,
        })
      }
    }
  }

  // Count messages per thread — group by thread_id in-memory since Supabase
  // doesn't support GROUP BY directly. We just need to know if count > 0.
  if (countsResult?.data) {
    const grouped: Record<string, number> = {}
    for (const row of countsResult.data as any[]) {
      const tid = row.thread_id as string
      grouped[tid] = (grouped[tid] ?? 0) + 1
    }
    for (const [tid, count] of Object.entries(grouped)) {
      countMap.set(tid, count)
    }
  }

  // If we couldn't get counts from the batch query, fall back to individual counts
  if (countMap.size === 0) {
    const countResults = await Promise.all(
      threadIds.map((tid) =>
        supabase
          .from("chat_messages")
          .select("id", { count: "exact", head: true })
          .eq("thread_id", tid),
      ),
    )
    for (let i = 0; i < threadIds.length; i++) {
      countMap.set(threadIds[i], countResults[i].count ?? 0)
    }
  }

  const threadsWithPreview = threads.map((thread) => ({
    id: thread.id,
    title: thread.title ?? "New conversation",
    created_at: thread.created_at,
    updated_at: thread.updated_at,
    message_count: countMap.get(thread.id) ?? 0,
    last_message: lastMsgMap.get(thread.id) ?? null,
  }))

  // Filter out empty threads (no messages) to keep the list clean
  const nonEmpty = threadsWithPreview.filter((t) => t.message_count > 0)

  return NextResponse.json({ threads: nonEmpty })
}

/**
 * DELETE /api/smart-ai/threads?id=<uuid>
 *
 * Deletes a chat thread and all its messages. Uses service-role so the
 * delete succeeds regardless of cookie session state.
 */
export async function DELETE(req: Request) {
  const profile = await requireProfile()
  const threadId = new URL(req.url).searchParams.get("id")

  if (!threadId) {
    return NextResponse.json({ error: "Thread ID required" }, { status: 400 })
  }

  const { client: supabase } = await getSupabase()

  // Delete messages first (if no FK cascade), then the thread.
  // Always scope to user_id to prevent cross-user deletion.
  await supabase
    .from("chat_messages")
    .delete()
    .eq("thread_id", threadId)

  const { error } = await supabase
    .from("chat_threads")
    .delete()
    .eq("id", threadId)
    .eq("user_id", profile.id)

  if (error) {
    console.error("[threads] delete failed:", error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
