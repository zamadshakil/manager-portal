import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { content } = (await req.json()) as { content: string }
  if (!content?.trim()) return NextResponse.json({ error: "content is required" }, { status: 400 })

  const admin = createAdminClient()

  const { data, error } = await admin
    .from("messages")
    .update({ content, edited_at: new Date().toISOString() })
    .eq("id", id)
    .eq("sender_id", user.id)
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

  const { error } = await admin
    .from("messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("sender_id", user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
