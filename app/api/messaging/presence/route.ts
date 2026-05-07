import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getRedis } from "@/lib/redis"

// POST /api/messaging/presence  — heartbeat to mark user online (TTL 90s)
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const redis = getRedis()
  if (redis) {
    await redis.set(`presence:${user.id}`, "1", "EX", 90)
  }

  return NextResponse.json({ ok: true })
}

// GET /api/messaging/presence?userIds=uid1,uid2
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const raw = searchParams.get("userIds") ?? ""
  const userIds = raw.split(",").filter(Boolean)
  if (!userIds.length) return NextResponse.json({})

  const redis = getRedis()
  if (!redis) return NextResponse.json(Object.fromEntries(userIds.map((id) => [id, false])))

  const pipeline = redis.multi()
  userIds.forEach((id) => pipeline.exists(`presence:${id}`))
  const results = await pipeline.exec()

  const map: Record<string, boolean> = {}
  userIds.forEach((id, i) => {
    const val = results?.[i]?.[1]
    map[id] = val === 1
  })

  return NextResponse.json(map)
}
