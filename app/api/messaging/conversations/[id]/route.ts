import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const admin = createAdminClient()

  const { data: conv, error } = await admin
    .from("conversations")
    .select(`
      id, type, name, created_by, avatar_url, created_at, updated_at,
      conversation_members (
        user_id, role, joined_at, last_read_at, removed_at,
        profiles:profiles!user_id ( id, full_name, email, avatar_url, deleted_at )
      )
    `)
    .eq("id", id)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 404 })

  // Auth check — must be an active (not removed) member
  const members = (conv.conversation_members as { user_id: string; removed_at: string | null }[]) ?? []
  if (!members.some((m) => m.user_id === user.id && !m.removed_at)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  return NextResponse.json({
    ...conv,
    members: (conv.conversation_members ?? []).map((m: any) => ({
      ...m,
      profile: m.profiles,
    })),
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const admin = createAdminClient()

  // Must be an active admin member (not removed)
  const { data: membership } = await admin
    .from("conversation_members")
    .select("role")
    .eq("conversation_id", id)
    .eq("user_id", user.id)
    .is("removed_at", null)
    .maybeSingle()
  if (!membership || membership.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const { name, avatar_url } = body as { name?: string; avatar_url?: string }

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 })
    }
    if (name.length > 120) {
      return NextResponse.json({ error: "name must be 120 characters or fewer" }, { status: 400 })
    }
  }
  if (avatar_url !== undefined && avatar_url !== null) {
    if (typeof avatar_url !== "string" || avatar_url.length > 500) {
      return NextResponse.json({ error: "avatar_url must be a string of 500 characters or fewer" }, { status: 400 })
    }
    if (/^javascript:/i.test(avatar_url.trim())) {
      return NextResponse.json({ error: "avatar_url scheme not allowed" }, { status: 400 })
    }
  }
  if (name === undefined && avatar_url === undefined) {
    return NextResponse.json({ error: "Provide name or avatar_url to update" }, { status: 400 })
  }

  const { data, error } = await admin
    .from("conversations")
    .update({ name, avatar_url })
    .eq("id", id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const admin = createAdminClient()

  const { data: conv } = await admin
    .from("conversations")
    .select("id, type")
    .eq("id", id)
    .maybeSingle()
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (conv.type !== "group") {
    return NextResponse.json({ error: "Only groups can be permanently deleted" }, { status: 400 })
  }

  const { data: membership } = await admin
    .from("conversation_members")
    .select("role")
    .eq("conversation_id", id)
    .eq("user_id", user.id)
    .is("removed_at", null)
    .maybeSingle()
  if (!membership || membership.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { data: deletedRows, error } = await admin
    .from("conversations")
    .delete()
    .eq("id", id)
    .select("id")

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!deletedRows || deletedRows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true, id })
}
