import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { putRaw } from "@/lib/r2"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

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

const MAX_SIZE = 50 * 1024 * 1024
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL ?? "").trim()

function inferMessageType(contentType: string): "image" | "audio" | "video" | "file" {
  if (contentType.startsWith("image/")) return "image"
  if (contentType.startsWith("audio/")) return "audio"
  if (contentType.startsWith("video/")) return "video"
  return "file"
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 })
  }

  const conversationId = formData.get("conversationId")
  const file = formData.get("file")

  if (typeof conversationId !== "string" || !conversationId) {
    return NextResponse.json({ error: "conversationId is required" }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 })
  }
  if (!file.type || !ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "File type not allowed" }, { status: 415 })
  }
  if (file.size <= 0) {
    return NextResponse.json({ error: "Empty file" }, { status: 400 })
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "File too large (max 50 MB)" }, { status: 413 })
  }
  const isPublicCdn =
    Boolean(R2_PUBLIC_URL) &&
    R2_PUBLIC_URL.startsWith("https://") &&
    !R2_PUBLIC_URL.includes("r2.cloudflarestorage.com")

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin"
  const key = `messaging/${conversationId}/${crypto.randomUUID()}.${ext}`

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const res = await putRaw(key, buffer, file.type, {
      cacheControl: "public, max-age=31536000, immutable",
    })

    const finalUrl = isPublicCdn && res.url.startsWith("http")
      ? res.url
      : `/api/messaging/media/${key}`

    return NextResponse.json({
      ok: true,
      url: finalUrl,
      type: inferMessageType(file.type),
      media_metadata: {
        name: file.name,
        size: file.size,
        contentType: file.type,
      },
    })
  } catch (err: unknown) {
    console.error("[messaging-upload] upload failed:", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Upload failed" }, { status: 500 })
  }
}
