import { NextResponse } from "next/server"
import { requireProfile } from "@/lib/auth"
import { createClient as createBrowserClient } from "@/lib/supabase/server"
import { createClient as createSBClient } from "@supabase/supabase-js"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/smart-ai/threads/[id]/messages
 *
 * Returns all messages for a specific thread. Uses service-role to avoid
 * cookie-session RLS issues, with explicit ownership verification via the
 * parent thread's user_id.
 *
 * The response shape is compatible with AI SDK v6 UIMessage[] so
 * the chat panel can load them directly via setMessages().
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireProfile()
  const { id: threadId } = await params

  // Build client — prefer service-role for reliable reads
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ""

  const supabase =
    serviceRoleKey && supabaseUrl
      ? createSBClient(supabaseUrl, serviceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : await createBrowserClient()

  // Verify the thread belongs to the authenticated user
  const { data: thread } = await supabase
    .from("chat_threads")
    .select("id, user_id")
    .eq("id", threadId)
    .maybeSingle()

  if (!thread || thread.user_id !== profile.id) {
    return NextResponse.json(
      { error: "Thread not found or access denied" },
      { status: 404 },
    )
  }

  const { data: messages, error } = await supabase
    .from("chat_messages")
    .select("id, role, content, metadata, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(200)

  if (error) {
    console.error("[threads] messages fetch failed:", error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Transform DB rows into AI SDK UIMessage-compatible shape.
  // The chat panel will reconstruct the full UIMessage via setMessages().
  const uiMessages = (messages ?? [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      id: m.id as string,
      role: m.role as "user" | "assistant",
      content: m.content as string,
      metadata: (m.metadata as Record<string, unknown>) ?? {},
      createdAt: m.created_at as string,
      parts: [{ type: "text" as const, text: m.content as string }],
    }))

  return NextResponse.json({ messages: uiMessages })
}
