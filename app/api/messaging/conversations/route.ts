import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const admin = createAdminClient()

  // Single round-trip: members + last_message + unread_count computed in SQL.
  // Previously this was 1 + 1 + 2N queries (N = number of conversations).
  // See migration 20260511_messaging_perf.sql for the RPC definition.
  const { data, error } = await admin.rpc("get_conversation_previews", {
    p_user_id: user.id,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data ?? [])
}

// ── shape limits ─────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_GROUP_MEMBERS = 100
const MAX_GROUP_NAME_LEN = 120

async function fetchConversationWithMembers(admin: ReturnType<typeof createAdminClient>, conversationId: string) {
  const { data: members } = await admin
    .from("conversation_members")
    .select("user_id, role, joined_at, last_read_at, profiles:profiles!user_id ( id, full_name, email, avatar_url )")
    .eq("conversation_id", conversationId)
  return (members ?? []).map((m: any) => ({ ...m, profile: m.profiles }))
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 })
  }
  const { type, name, memberIds } = body as {
    type?: unknown
    name?: unknown
    memberIds?: unknown
  }

  // ── shape & semantic validation ──────────────────────────────
  if (type !== "dm" && type !== "group") {
    return NextResponse.json({ error: "type must be 'dm' or 'group'" }, { status: 400 })
  }
  if (!Array.isArray(memberIds)) {
    return NextResponse.json({ error: "memberIds must be an array" }, { status: 400 })
  }

  // Sanitize: strings only, valid UUIDs, drop the creator (always added),
  // dedup, and cap to a sane upper bound.
  const cleanMemberIds = Array.from(
    new Set(
      memberIds
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter((v) => UUID_RE.test(v) && v !== user.id),
    ),
  )

  if (cleanMemberIds.length === 0) {
    return NextResponse.json({ error: "at least one other user is required" }, { status: 400 })
  }
  if (cleanMemberIds.length > MAX_GROUP_MEMBERS) {
    return NextResponse.json({ error: `too many members (max ${MAX_GROUP_MEMBERS})` }, { status: 400 })
  }

  let groupName: string | null = null
  if (type === "group") {
    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "name is required for groups" }, { status: 400 })
    }
    if (name.length > MAX_GROUP_NAME_LEN) {
      return NextResponse.json({ error: "name too long" }, { status: 400 })
    }
    groupName = name.trim()
  } else {
    // type === "dm"
    if (cleanMemberIds.length !== 1) {
      return NextResponse.json({ error: "DM must have exactly one other user" }, { status: 400 })
    }
    if (name !== undefined && name !== null) {
      return NextResponse.json({ error: "DMs cannot have a name" }, { status: 400 })
    }
  }

  const admin = createAdminClient()

  // Verify all referenced profiles exist and are not soft-deleted.
  // The `deleted_at` column was added in 20260508_profile_soft_delete.sql.
  const { data: profiles, error: pErr } = await admin
    .from("profiles")
    .select("id, deleted_at")
    .in("id", cleanMemberIds)
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })

  const liveIds = new Set(
    (profiles ?? [])
      .filter((p: any) => !p.deleted_at)
      .map((p: any) => p.id as string),
  )
  const missing = cleanMemberIds.filter((id) => !liveIds.has(id))
  if (missing.length > 0) {
    return NextResponse.json({ error: "one or more users are unavailable" }, { status: 400 })
  }

  // ── DM: atomic find-or-create via RPC (advisory-lock protected) ──
  if (type === "dm") {
    const otherId = cleanMemberIds[0]
    const { data: rpcRows, error: rpcErr } = await admin.rpc("find_or_create_dm", {
      user_a: user.id,
      user_b: otherId,
    })
    if (rpcErr || !rpcRows || (rpcRows as any[]).length === 0) {
      return NextResponse.json({ error: rpcErr?.message ?? "failed to create DM" }, { status: 500 })
    }
    const dm = (rpcRows as any[])[0]
    const members = await fetchConversationWithMembers(admin, dm.id)
    return NextResponse.json(
      {
        id: dm.id,
        type: dm.type,
        name: dm.name,
        created_by: dm.created_by,
        avatar_url: dm.avatar_url,
        created_at: dm.created_at,
        updated_at: dm.updated_at,
        members,
      },
      { status: dm.was_created ? 201 : 200 },
    )
  }

  // ── Group: insert + add members ──────────────────────────────
  const { data: conv, error: cErr } = await admin
    .from("conversations")
    .insert({ type, name: groupName, created_by: user.id })
    .select()
    .single()
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })

  const memberRows = [
    { conversation_id: conv.id, user_id: user.id, role: "admin" as const },
    ...cleanMemberIds.map((uid) => ({
      conversation_id: conv.id,
      user_id: uid,
      role: "member" as const,
    })),
  ]

  const { error: mErr } = await admin.from("conversation_members").insert(memberRows)
  if (mErr) {
    // best-effort cleanup so we don't leave an orphaned conversation
    await admin.from("conversations").delete().eq("id", conv.id)
    return NextResponse.json({ error: mErr.message }, { status: 500 })
  }

  return NextResponse.json(
    {
      ...conv,
      members: await fetchConversationWithMembers(admin, conv.id),
    },
    { status: 201 },
  )
}
