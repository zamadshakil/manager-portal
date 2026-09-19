import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { putRaw } from "@/lib/r2"
import { createHash } from "node:crypto"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BYTES = 4 * 1024 * 1024 // 4 MB limit


type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const admin = createAdminClient()

  const { data: membership } = await admin
    .from("conversation_members")
    .select("role")
    .eq("conversation_id", id)
    .eq("user_id", user.id)
    .maybeSingle()
  if (!membership || membership.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let file: File | null = null
  try {
    const fd = await req.formData()
    file = (fd.get("file") as File) ?? null
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 })
  }

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Only image files are accepted" }, { status: 415 })
  }

  const buf = Buffer.from(await file.arrayBuffer())
  if (buf.byteLength === 0) return NextResponse.json({ error: "Empty file" }, { status: 400 })
  if (buf.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: "Image exceeds 500 KB limit" }, { status: 413 })
  }

  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase()
  const hash = createHash("sha1").update(buf).digest("hex").slice(0, 16)
  const key = `messaging-groups/${id}/${hash}.${ext}`

  const isPublicCdn =
    process.env.R2_PUBLIC_URL &&
    process.env.R2_PUBLIC_URL.startsWith("https://") &&
    !process.env.R2_PUBLIC_URL.includes("r2.cloudflarestorage.com")

  let avatarUrl = `data:${file.type};base64,${buf.toString("base64")}`

  if (isPublicCdn) {
    try {
      const { url } = await putRaw(key, buf, file.type, {
        cacheControl: "public, max-age=31536000, immutable",
      })
      if (url && url.startsWith("http")) {
        avatarUrl = url
      }
    } catch (err) {
      console.warn("[group-avatar] R2 upload failed, using data URL fallback:", err)
    }
  } else if (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY) {
    putRaw(key, buf, file.type).catch(() => {})
  }

  try {
    const { data, error } = await admin
      .from("conversations")
      .update({ avatar_url: avatarUrl })
      .eq("id", id)
      .select("id, avatar_url")
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, url: data.avatar_url })
  } catch (err: unknown) {
    console.error("[group-avatar] upload failed:", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Upload failed" }, { status: 500 })
  }
}
