import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const conv = searchParams.get("conv")
  const before = searchParams.get("before") // ISO cursor — load older messages
  const after  = searchParams.get("after")  // ISO cursor — poll for newer messages
  const limit  = Math.min(parseInt(searchParams.get("limit") ?? "50"), 100)

  if (!conv) return NextResponse.json({ error: "conv is required" }, { status: 400 })

  const admin = createAdminClient()

  // Auth check
  const { data: membership } = await admin
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conv)
    .eq("user_id", user.id)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  // after-cursor polls return ascending (oldest-first already); before-cursor
  // returns descending then we reverse client-side to get oldest-first.
  const ascending = !!after

  let query = admin
    .from("messages")
    .select(`
      id, conversation_id, sender_id, content, type,
      media_url, media_metadata, reply_to_id, edited_at, deleted_at, created_at,
      sender:profiles!sender_id ( id, full_name, email, avatar_url ),
      reactions:message_reactions ( message_id, user_id, emoji, created_at ),
      reply_to:messages!reply_to_id (
        id, content, type,
        sender:profiles!sender_id ( id, full_name, email, avatar_url )
      )
    `)
    .eq("conversation_id", conv)
    .is("deleted_at", null)
    .order("created_at", { ascending })
    .limit(limit)

  if (after)  query = query.gt("created_at", after)
  if (before) query = query.lt("created_at", before)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // after-queries are already ascending; before-queries need reversal
  return NextResponse.json(ascending ? (data ?? []) : (data ?? []).reverse())
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const { conversation_id, content, type = "text", media_url, media_metadata, reply_to_id } = body as {
    conversation_id: string
    content?: string
    type?: string
    media_url?: string
    media_metadata?: Record<string, unknown>
    reply_to_id?: string
  }

  if (!conversation_id) {
    return NextResponse.json({ error: "conversation_id is required" }, { status: 400 })
  }
  if (!content && !media_url) {
    return NextResponse.json({ error: "content or media_url is required" }, { status: 400 })
  }

  const admin = createAdminClient()

  // Auth check — must be a member
  const { data: membership } = await admin
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversation_id)
    .eq("user_id", user.id)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { data, error } = await admin
    .from("messages")
    .insert({
      conversation_id,
      sender_id: user.id,
      content: content ?? null,
      type,
      media_url: media_url ?? null,
      media_metadata: media_metadata ?? null,
      reply_to_id: reply_to_id ?? null,
    })
    .select(`
      id, conversation_id, sender_id, content, type,
      media_url, media_metadata, reply_to_id, edited_at, deleted_at, created_at,
      sender:profiles!sender_id ( id, full_name, email, avatar_url )
    `)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data, { status: 201 })
}
