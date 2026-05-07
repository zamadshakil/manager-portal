import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const admin = createAdminClient()

  // Must already be a member to add others
  const { data: membership } = await admin
    .from("conversation_members")
    .select("role")
    .eq("conversation_id", id)
    .eq("user_id", user.id)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { userIds } = (await req.json()) as { userIds: string[] }
  if (!userIds?.length) return NextResponse.json({ error: "userIds required" }, { status: 400 })

  const rows = userIds.map((uid: string) => ({
    conversation_id: id,
    user_id: uid,
    role: "member",
  }))

  const { error } = await admin.from("conversation_members").upsert(rows, { onConflict: "conversation_id,user_id" })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
