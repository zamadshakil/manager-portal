import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { emoji } = (await req.json()) as { emoji: string }
  if (!emoji) return NextResponse.json({ error: "emoji is required" }, { status: 400 })

  const admin = createAdminClient()

  // Check if reaction already exists — if so, remove it (toggle)
  const { data: existing } = await admin
    .from("message_reactions")
    .select("message_id")
    .eq("message_id", id)
    .eq("user_id", user.id)
    .eq("emoji", emoji)
    .maybeSingle()

  if (existing) {
    const { error } = await admin
      .from("message_reactions")
      .delete()
      .eq("message_id", id)
      .eq("user_id", user.id)
      .eq("emoji", emoji)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ action: "removed" })
  }

  const { error } = await admin
    .from("message_reactions")
    .insert({ message_id: id, user_id: user.id, emoji })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ action: "added" })
}
