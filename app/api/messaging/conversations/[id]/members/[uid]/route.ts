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

  // Allow self-removal or admin removal
  if (uid !== user.id) {
    const { data: membership } = await admin
      .from("conversation_members")
      .select("role")
      .eq("conversation_id", id)
      .eq("user_id", user.id)
      .maybeSingle()
    if (!membership || membership.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  const { error } = await admin
    .from("conversation_members")
    .delete()
    .eq("conversation_id", id)
    .eq("user_id", uid)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
