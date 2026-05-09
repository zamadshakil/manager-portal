import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

type Params = { params: Promise<{ id: string; uid: string }> }

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, uid } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const admin = createAdminClient()

  if (uid === user.id) {
    // Self-removal: hard delete — user is voluntarily leaving
    const { error } = await admin
      .from("conversation_members")
      .delete()
      .eq("conversation_id", id)
      .eq("user_id", uid)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // Admin removing another member: verify caller is admin of this conversation
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

  // Soft-delete: record who was removed and when (preserves history)
  const { error } = await admin
    .from("conversation_members")
    .update({ removed_at: new Date().toISOString(), removed_by: user.id })
    .eq("conversation_id", id)
    .eq("user_id", uid)
    .is("removed_at", null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
