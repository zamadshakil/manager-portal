import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getRedis } from "@/lib/redis"

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { conv, name } = (await req.json()) as { conv: string; name: string }
  if (!conv) return NextResponse.json({ error: "conv is required" }, { status: 400 })

  // Only members of the conversation may write typing indicators.
  const admin = createAdminClient()
  const { data: membership } = await admin
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conv)
    .eq("user_id", user.id)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const redis = getRedis()
  if (redis) {
    await redis.set(`typing:${conv}:${user.id}`, name ?? user.id, "EX", 3)
  }

  return NextResponse.json({ ok: true })
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const conv = searchParams.get("conv")
  if (!conv) return NextResponse.json({ error: "conv is required" }, { status: 400 })

  const redis = getRedis()
  if (!redis) return NextResponse.json([])

  const keys = await redis.keys(`typing:${conv}:*`)
  if (!keys.length) return NextResponse.json([])

  const names = await redis.mget(...keys)
  const result = keys.map((key: string, i: number) => ({
    userId: key.split(":")[2],
    name: names[i] ?? "Someone",
  }))

  return NextResponse.json(result)
}
