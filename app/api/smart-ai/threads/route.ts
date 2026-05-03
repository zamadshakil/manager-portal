import { NextResponse } from "next/server"
import { requireProfile } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/smart-ai/threads
 *
 * Returns all chat threads for the authenticated user, sorted by most recent
 * activity. Each thread includes a preview of the last message so the UI
 * can show a meaningful label without a second round-trip.
 *
 * RLS on `chat_threads` enforces user_id = auth.uid(), so we only ever
 * return threads belonging to the caller.
 */
export async function GET(req: Request) {
  const profile = await requireProfile()
  const supabase = await createClient()

  const limit = Math.min(
    Number(new URL(req.url).searchParams.get("limit") ?? "50"),
    100,
  )

  // Fetch threads with the latest message content as a preview.
  // We use a subquery to grab the most recent message per thread.
  const { data: threads, error } = await supabase
    .from("chat_threads")
    .select("id, title, created_at, updated_at")
    .eq("user_id", profile.id)
    .order("updated_at", { ascending: false })
    .limit(limit)

  if (error) {
    console.error("[threads] list failed:", error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // For each thread, fetch the latest message as a preview
  const threadsWithPreview = await Promise.all(
    (threads ?? []).map(async (thread) => {
      const { data: lastMsg } = await supabase
        .from("chat_messages")
        .select("role, content, created_at")
        .eq("thread_id", thread.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      // Count messages in thread
      const { count } = await supabase
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("thread_id", thread.id)

      return {
        id: thread.id,
        title: thread.title ?? "New conversation",
        created_at: thread.created_at,
        updated_at: thread.updated_at,
        message_count: count ?? 0,
        last_message: lastMsg
          ? {
              role: lastMsg.role as string,
              content: (lastMsg.content as string)?.slice(0, 120) ?? "",
              created_at: lastMsg.created_at as string,
            }
          : null,
      }
    }),
  )

  // Filter out empty threads (no messages) to keep the list clean
  const nonEmpty = threadsWithPreview.filter((t) => t.message_count > 0)

  return NextResponse.json({ threads: nonEmpty })
}

/**
 * DELETE /api/smart-ai/threads?id=<uuid>
 *
 * Deletes a chat thread and all its messages. RLS ensures only the
 * owning user can delete. Messages are expected to cascade via FK.
 */
export async function DELETE(req: Request) {
  const profile = await requireProfile()
  const threadId = new URL(req.url).searchParams.get("id")

  if (!threadId) {
    return NextResponse.json({ error: "Thread ID required" }, { status: 400 })
  }

  const supabase = await createClient()

  // Delete messages first (if no FK cascade), then the thread
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
