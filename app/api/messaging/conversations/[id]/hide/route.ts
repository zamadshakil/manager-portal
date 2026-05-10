import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const admin = createAdminClient()

  // Verify the user is a member of this conversation
  const { data: membership } = await admin
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", id)
    .eq("user_id", user.id)
    .is("removed_at", null)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  // Set hidden_at — hides the conversation from this user's sidebar only
  const { error } = await admin
    .from("conversation_members")
    .update({ hidden_at: new Date().toISOString() } as any)
    .eq("conversation_id", id)
    .eq("user_id", user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
