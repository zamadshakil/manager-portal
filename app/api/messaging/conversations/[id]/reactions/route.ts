import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { id: conversationId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const after = searchParams.get("after") ?? new Date(0).toISOString()

  const admin = createAdminClient()

  // Auth check — must be a member of this conversation
  const { data: membership } = await admin
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", user.id)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  // Fetch reactions added after the cursor for messages in this conversation.
  // Since hard-deleted reactions have no tombstone row we return only additions;
  // removes are handled by the 30 s full-sync safety net in the hook.
  const { data, error } = await admin
    .from("message_reactions")
    .select(`
      message_id, user_id, emoji, created_at,
      message:messages!message_id ( conversation_id )
    `)
    .gt("created_at", after)
    .order("created_at", { ascending: true })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Filter to only reactions for this conversation and attach action
  const filtered = (data ?? [])
    .filter((r: any) => r.message?.conversation_id === conversationId)
    .map((r: any) => ({
      message_id: r.message_id,
      user_id:    r.user_id,
      emoji:      r.emoji,
      created_at: r.created_at,
      action:     "added" as const,
    }))

  return NextResponse.json(filtered)
}
