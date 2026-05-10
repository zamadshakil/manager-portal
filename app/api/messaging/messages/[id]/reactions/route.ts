import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

type Params = { params: Promise<{ id: string }> }

const EMOJI_RE = /^\p{Emoji}/u

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { emoji } = (await req.json()) as { emoji: string }
  if (!emoji || !EMOJI_RE.test(emoji))
    return NextResponse.json({ error: "emoji is required" }, { status: 400 })

  const admin = createAdminClient()

  // Verify the message exists and the caller is a member of its conversation.
  const { data: msg } = await admin
    .from("messages")
    .select("conversation_id")
    .eq("id", id)
    .maybeSingle()
  if (!msg) return NextResponse.json({ error: "Message not found" }, { status: 404 })

  const { data: member } = await admin
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", msg.conversation_id)
    .eq("user_id", user.id)
    .is("removed_at", null)
    .maybeSingle()
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  // Single round-trip toggle via RPC (migration 20260512_messaging_ux.sql).
  // INSERT ... ON CONFLICT DO NOTHING: if inserted → "added"; else DELETE → "removed".
  const { data: action, error } = await admin.rpc("toggle_reaction", {
    p_message_id: id,
    p_user_id: user.id,
    p_emoji: emoji,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ action })
}
