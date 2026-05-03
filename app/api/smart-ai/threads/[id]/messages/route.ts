import { NextResponse } from "next/server"
import { requireProfile } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/smart-ai/threads/[id]/messages
 *
 * Returns all messages for a specific thread. RLS on chat_messages
 * ensures the user can only read messages from threads they own
 * (via the parent chat_threads.user_id = auth.uid() policy).
 *
 * The response shape is compatible with AI SDK v6 UIMessage[] so
 * the chat panel can load them directly via setMessages().
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireProfile()
  const { id: threadId } = await params
  const supabase = await createClient()

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
