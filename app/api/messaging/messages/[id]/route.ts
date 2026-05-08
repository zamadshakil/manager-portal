import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

type Params = { params: Promise<{ id: string }> }

const MAX_CONTENT_LEN = 8_000 // must match POST validation in messages/route.ts

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { content } = (await req.json()) as { content: string }
  if (!content?.trim()) return NextResponse.json({ error: "content is required" }, { status: 400 })
  if (content.length > MAX_CONTENT_LEN) return NextResponse.json({ error: "content too long" }, { status: 413 })

  const admin = createAdminClient()

  const { data, error } = await admin
    .from("messages")
    .update({ content, edited_at: new Date().toISOString() })
    .eq("id", id)
    .eq("sender_id", user.id)
    .select()
    .single()
  // PGRST116 = "0 rows" — message not found or caller is not the sender
  if (error) {
    if (error.code === "PGRST116") return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const admin = createAdminClient()

  // Use select() so we can detect 0 rows (message not found or not owned)
  const { data, error } = await admin
    .from("messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("sender_id", user.id)
    .select("id")
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json({ ok: true })
}
