import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const admin = createAdminClient()

  // Get all conversations this user is a member of
  const { data: memberships, error: mErr } = await admin
    .from("conversation_members")
    .select("conversation_id, last_read_at")
    .eq("user_id", user.id)
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 })

  const convIds = memberships?.map((m) => m.conversation_id) ?? []
  if (convIds.length === 0) return NextResponse.json([])

  const { data: convs, error: cErr } = await admin
    .from("conversations")
    .select(`
      id, type, name, created_by, avatar_url, created_at, updated_at,
      conversation_members (
        user_id, role, joined_at, last_read_at,
        profiles:profiles!user_id ( id, full_name, email, avatar_url, deleted_at )
      )
    `)
    .in("id", convIds)
    .order("updated_at", { ascending: false })
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })

  // Attach last message + unread count to each conversation
  const enriched = await Promise.all(
    (convs ?? []).map(async (conv) => {
      const myMembership = memberships?.find((m) => m.conversation_id === conv.id)
      const lastReadAt = myMembership?.last_read_at ?? new Date(0).toISOString()

      const [{ data: lastMsg }, { count: unread }] = await Promise.all([
        admin
          .from("messages")
          .select("id, content, type, sender_id, created_at, deleted_at")
          .eq("conversation_id", conv.id)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        admin
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", conv.id)
          .is("deleted_at", null)
          .gt("created_at", lastReadAt),
      ])

      return {
        ...conv,
        members: (conv.conversation_members ?? []).map((m: any) => ({
          ...m,
          profile: m.profiles,
        })),
        last_message: lastMsg ?? null,
        unread_count: unread ?? 0,
      }
    }),
  )

  return NextResponse.json(enriched)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const { type, name, memberIds } = body as {
    type: "dm" | "group"
    name?: string
    memberIds: string[]
  }

  if (!type || !memberIds || memberIds.length === 0) {
    return NextResponse.json({ error: "type and memberIds are required" }, { status: 400 })
  }

  const admin = createAdminClient()

  // For DMs, check if one already exists between these two users
  if (type === "dm" && memberIds.length === 1) {
    const otherId = memberIds[0]
    const { data: existing } = await admin.rpc("find_dm_conversation", {
      user_a: user.id,
      user_b: otherId,
    })
    if (existing && existing.length > 0) {
      // Fetch members so the sidebar can resolve the other user's name
      const { data: members } = await admin
        .from("conversation_members")
        .select("user_id, role, joined_at, last_read_at, profiles:profiles!user_id ( id, full_name, email, avatar_url )")
        .eq("conversation_id", existing[0].id)
      return NextResponse.json({
        ...existing[0],
        members: (members ?? []).map((m: any) => ({ ...m, profile: m.profiles })),
      })
    }
  }

  // Create conversation
  const { data: conv, error: cErr } = await admin
    .from("conversations")
    .insert({ type, name: name ?? null, created_by: user.id })
    .select()
    .single()
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })

  // Add members (include creator as admin)
  const allMembers = Array.from(new Set([user.id, ...memberIds]))
  const memberRows = allMembers.map((uid) => ({
    conversation_id: conv.id,
    user_id: uid,
    role: uid === user.id ? "admin" : "member",
  }))

  const { error: mErr } = await admin.from("conversation_members").insert(memberRows)
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 })

  // Return with members so the sidebar can resolve names / avatars
  const { data: members } = await admin
    .from("conversation_members")
    .select("user_id, role, joined_at, last_read_at, profiles:profiles!user_id ( id, full_name, email, avatar_url )")
    .eq("conversation_id", conv.id)

  return NextResponse.json({
    ...conv,
    members: (members ?? []).map((m: any) => ({ ...m, profile: m.profiles })),
  }, { status: 201 })
}
