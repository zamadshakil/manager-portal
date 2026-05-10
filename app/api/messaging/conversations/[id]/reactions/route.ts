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
    .is("removed_at", null)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  // Fetch reactions added after the cursor for messages in THIS conversation.
  // We filter server-side via the denormalized conversation_id column added
  // in migration 20260509_messaging_security_critical.sql so we never load
  // reactions belonging to other conversations into the Node process.
  // Since hard-deleted reactions have no tombstone row we return only additions;
  // removes are handled by the 30 s full-sync safety net in the hook.
  const { data, error } = await admin
    .from("message_reactions")
    .select("message_id, user_id, emoji, created_at")
    .eq("conversation_id", conversationId)
    .gt("created_at", after)
    .order("created_at", { ascending: true })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const result = (data ?? []).map((r) => ({
    message_id: r.message_id as string,
    user_id:    r.user_id    as string,
    emoji:      r.emoji      as string,
    created_at: r.created_at as string,
    action:     "added" as const,
  }))

  return NextResponse.json(result)
}
