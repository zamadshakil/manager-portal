import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { requireProfile } from "@/lib/auth"
import { putRaw, del } from "@/lib/r2"
import { createHash } from "node:crypto"
import { enforceApiRateLimit } from "@/lib/api-rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BYTES = 350 * 1024 // 350KB hard cap after client-side downscale

function isWebp(buffer: Buffer) {
  return (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  )
}

export async function POST(req: Request) {
  const limited = await enforceApiRateLimit(req, {
    prefix: "api:uploads:avatar",
    limit: 20,
    windowMs: 60_000,
  })
  if (limited) return limited

  let profile
  try {
    profile = await requireProfile()
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  let file: File | null = null
  try {
    const fd = await req.formData()
    file = (fd.get("file") as File) ?? null
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid form data" }, { status: 400 })
  }

  if (!file) return NextResponse.json({ ok: false, error: "No file provided" }, { status: 400 })
  if (file.type !== "image/webp") {
    return NextResponse.json({ ok: false, error: "Only WebP images are accepted" }, { status: 415 })
  }

  const buf = Buffer.from(await file.arrayBuffer())
  if (buf.byteLength === 0) return NextResponse.json({ ok: false, error: "Empty file" }, { status: 400 })
  if (buf.byteLength > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "Avatar exceeds 350KB limit" }, { status: 413 })
  }
  if (!isWebp(buf)) {
    return NextResponse.json({ ok: false, error: "Invalid WebP file" }, { status: 415 })
  }

  const hash = createHash("sha1").update(buf).digest("hex").slice(0, 16)
  const key = `avatars/${profile.id}/${hash}.webp`

  let url: string
  if (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY) {
    try {
      const res = await putRaw(key, buf, "image/webp", {
        cacheControl: "public, max-age=31536000, immutable",
      })
      url = res.url
    } catch (r2Err) {
      console.warn("[avatar] R2 upload failed, falling back to data URL:", r2Err)
      url = `data:image/webp;base64,${buf.toString("base64")}`
    }
  } else {
    url = `data:image/webp;base64,${buf.toString("base64")}`
  }

  try {
    const supabase = await createClient()

    // Fetch old to delete after successful update
    const { data: oldRow } = await supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", profile.id)
      .single()

    const { error } = await supabase
      .from("profiles")
      .update({ avatar_url: url, updated_at: new Date().toISOString() })
      .eq("id", profile.id)

    if (error) {
      if (!url.startsWith("data:")) {
        try { await del(url) } catch {}
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    // Best-effort: remove prior object if different
    const prev = (oldRow as { avatar_url: string | null } | null)?.avatar_url
    if (prev && prev !== url && !prev.startsWith("data:")) {
      try { await del(prev) } catch {}
    }

    return NextResponse.json({ ok: true, url })
  } catch (err: unknown) {
    console.error("[avatar] upload failed:", err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: "Upload failed" }, { status: 500 })
  }
}
