import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

type Params = { params: Promise<{ id: string }> }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_INVITES_PER_REQUEST = 50

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const admin = createAdminClient()

  // Caller must be an admin of this conversation, and the conversation
  // must be a group. DMs are intentionally fixed two-person.
  const { data: conv } = await admin
    .from("conversations")
    .select("id, type")
    .eq("id", id)
    .maybeSingle()
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (conv.type !== "group") {
    return NextResponse.json({ error: "Cannot add members to a DM" }, { status: 400 })
  }

  const { data: membership } = await admin
    .from("conversation_members")
    .select("role, removed_at")
    .eq("conversation_id", id)
    .eq("user_id", user.id)
    .maybeSingle()
  if (!membership || membership.role !== "admin" || (membership as any).removed_at) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const rawIds = (body && Array.isArray((body as any).userIds)) ? (body as any).userIds : null
  if (!rawIds) {
    return NextResponse.json({ error: "userIds must be an array" }, { status: 400 })
  }

  const cleanIds = Array.from(
    new Set(
      rawIds
        .filter((v: unknown): v is string => typeof v === "string")
        .map((v: string) => v.trim())
        .filter((v: string) => UUID_RE.test(v) && v !== user.id),
    ),
  ) as string[]

  if (cleanIds.length === 0) {
    return NextResponse.json({ error: "at least one valid userId is required" }, { status: 400 })
  }
  if (cleanIds.length > MAX_INVITES_PER_REQUEST) {
    return NextResponse.json({ error: `too many invites (max ${MAX_INVITES_PER_REQUEST})` }, { status: 400 })
  }

  // Verify referenced profiles exist and are not soft-deleted.
  const { data: profiles, error: pErr } = await admin
    .from("profiles")
    .select("id, deleted_at")
    .in("id", cleanIds)
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })

  const liveIds = (profiles ?? [])
    .filter((p: any) => !p.deleted_at)
    .map((p: any) => p.id as string)
  if (liveIds.length === 0) {
    return NextResponse.json({ error: "no valid users to add" }, { status: 400 })
  }

  // Re-activate formerly-removed members (keep their existing role)
  const { error: reactivateErr } = await admin
    .from("conversation_members")
    .update({ removed_at: null, removed_by: null } as any)
    .eq("conversation_id", id)
    .in("user_id", liveIds)
    .not("removed_at", "is", null)
  if (reactivateErr) return NextResponse.json({ error: reactivateErr.message }, { status: 500 })

  // Insert brand-new members; skip if row already exists (avoids role downgrade)
  const newRows = liveIds.map((uid) => ({
    conversation_id: id,
    user_id: uid,
    role: "member" as const,
  }))
  const { error: insertErr } = await admin
    .from("conversation_members")
    .upsert(newRows, { onConflict: "conversation_id,user_id", ignoreDuplicates: true })
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, added: liveIds.length })
}
