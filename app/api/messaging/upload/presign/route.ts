import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { presignPut } from "@/lib/r2"

const ALLOWED_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "audio/mpeg", "audio/ogg", "audio/mp4", "audio/webm",
  "video/mp4", "video/webm",
])

const MAX_SIZE = 50 * 1024 * 1024 // 50 MB

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { conversationId, fileName, contentType, size } = (await req.json()) as {
    conversationId: string
    fileName: string
    contentType: string
    size: number
  }

  if (!conversationId || !fileName || !contentType) {
    return NextResponse.json({ error: "conversationId, fileName, contentType required" }, { status: 400 })
  }
  if (!ALLOWED_TYPES.has(contentType)) {
    return NextResponse.json({ error: "File type not allowed" }, { status: 400 })
  }
  if (size > MAX_SIZE) {
    return NextResponse.json({ error: "File too large (max 50 MB)" }, { status: 400 })
  }

  const ext = fileName.split(".").pop() ?? "bin"
  const key = `messaging/${conversationId}/${crypto.randomUUID()}.${ext}`

  const result = await presignPut(key, contentType)
  return NextResponse.json(result)
}
