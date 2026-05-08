import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const conv          = searchParams.get("conv")
  const before        = searchParams.get("before")        // ISO cursor — load older messages
  const after         = searchParams.get("after")         // ISO cursor — poll for newer messages
  const modifiedAfter = searchParams.get("modifiedAfter") // ISO cursor — poll for edits/deletes
  const limit         = Math.min(parseInt(searchParams.get("limit") ?? "50"), 100)

  if (!conv) return NextResponse.json({ error: "conv is required" }, { status: 400 })

  const admin = createAdminClient()

  // Auth check
  const { data: membership } = await admin
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conv)
    .eq("user_id", user.id)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const messageSelect = `
    id, conversation_id, sender_id, content, type,
    media_url, media_metadata, reply_to_id, edited_at, deleted_at, created_at,
    sender:profiles!sender_id ( id, full_name, email, avatar_url ),
    reactions:message_reactions ( message_id, user_id, emoji, created_at ),
    reply_to:messages!reply_to_id (
      id, content, type,
      sender:profiles!sender_id ( id, full_name, email, avatar_url )
    )
  `

  // modifiedAfter: return messages edited or deleted after the cursor (include deleted ones)
  if (modifiedAfter) {
    const { data, error } = await admin
      .from("messages")
      .select(messageSelect)
      .eq("conversation_id", conv)
      .or(`edited_at.gt."${modifiedAfter}",deleted_at.gt."${modifiedAfter}"`)
      .order("created_at", { ascending: true })
      .limit(limit)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data ?? [])
  }

  // after-cursor polls return ascending (oldest-first already); before-cursor
  // returns descending then we reverse client-side to get oldest-first.
  const ascending = !!after

  let query = admin
    .from("messages")
    .select(messageSelect)
    .eq("conversation_id", conv)
    .is("deleted_at", null)
    .order("created_at", { ascending })
    .limit(limit)

  if (after)  query = query.gt("created_at", after)
  if (before) query = query.lt("created_at", before)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // after-queries are already ascending; before-queries need reversal
  return NextResponse.json(ascending ? (data ?? []) : (data ?? []).reverse())
}

// Allowed message types (mirrors DB CHECK in 20260508_messaging.sql)
const ALLOWED_TYPES = new Set(["text", "image", "file", "audio", "video"])
const MEDIA_TYPES   = new Set(["image", "file", "audio", "video"])

// Hard caps to prevent abusive payloads
const MAX_CONTENT_LEN = 8_000          // chars
const MAX_MEDIA_URL_LEN = 1_024        // chars
const MAX_METADATA_BYTES = 4_096       // bytes of JSON

const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL ?? "").replace(/\/+$/, "")

/**
 * Reject media URLs that do not point at our R2 public bucket.
 * Without this check a member could send `media_url: "javascript:..."` or any
 * arbitrary URL, which the chat UI would render as an <img>/<a>/<video>.
 */
function isAllowedMediaUrl(url: string): boolean {
  if (!R2_PUBLIC_URL) return false
  if (url.length > MAX_MEDIA_URL_LEN) return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:") return false
    return url.startsWith(`${R2_PUBLIC_URL}/`)
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const { conversation_id, content, type = "text", media_url, media_metadata, reply_to_id } = body as {
    conversation_id: string
    content?: string
    type?: string
    media_url?: string
    media_metadata?: Record<string, unknown>
    reply_to_id?: string
  }

  // ── shape & semantic validation ──────────────────────────────
  if (!conversation_id || typeof conversation_id !== "string") {
    return NextResponse.json({ error: "conversation_id is required" }, { status: 400 })
  }
  if (!ALLOWED_TYPES.has(type)) {
    return NextResponse.json({ error: "invalid type" }, { status: 400 })
  }
  if (type === "text") {
    if (!content || !content.trim()) {
      return NextResponse.json({ error: "content is required for text messages" }, { status: 400 })
    }
    if (media_url) {
      return NextResponse.json({ error: "text messages cannot have media_url" }, { status: 400 })
    }
  } else if (MEDIA_TYPES.has(type)) {
    if (!media_url) {
      return NextResponse.json({ error: "media_url is required for media messages" }, { status: 400 })
    }
    if (!isAllowedMediaUrl(media_url)) {
      return NextResponse.json({ error: "media_url must reference an uploaded file" }, { status: 400 })
    }
  }
  if (content !== undefined && content !== null) {
    if (typeof content !== "string") {
      return NextResponse.json({ error: "content must be a string" }, { status: 400 })
    }
    if (content.length > MAX_CONTENT_LEN) {
      return NextResponse.json({ error: "content too long" }, { status: 413 })
    }
  }
  if (media_metadata !== undefined && media_metadata !== null) {
    try {
      const bytes = Buffer.byteLength(JSON.stringify(media_metadata), "utf8")
      if (bytes > MAX_METADATA_BYTES) {
        return NextResponse.json({ error: "media_metadata too large" }, { status: 413 })
      }
    } catch {
      return NextResponse.json({ error: "media_metadata is not serializable" }, { status: 400 })
    }
  }
  if (reply_to_id !== undefined && reply_to_id !== null && typeof reply_to_id !== "string") {
    return NextResponse.json({ error: "reply_to_id must be a string" }, { status: 400 })
  }

  const admin = createAdminClient()

  // Auth check — must be a member
  const { data: membership } = await admin
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversation_id)
    .eq("user_id", user.id)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  // If replying, verify the parent message belongs to the same conversation
  if (reply_to_id) {
    const { data: parent } = await admin
      .from("messages")
      .select("id, conversation_id")
      .eq("id", reply_to_id)
      .maybeSingle()
    if (!parent || parent.conversation_id !== conversation_id) {
      return NextResponse.json({ error: "reply_to_id does not belong to this conversation" }, { status: 400 })
    }
  }

  const { data, error } = await admin
    .from("messages")
    .insert({
      conversation_id,
      sender_id: user.id,
      content: content ?? null,
      type,
      media_url: media_url ?? null,
      media_metadata: media_metadata ?? null,
      reply_to_id: reply_to_id ?? null,
    })
    .select(`
      id, conversation_id, sender_id, content, type,
      media_url, media_metadata, reply_to_id, edited_at, deleted_at, created_at,
      sender:profiles!sender_id ( id, full_name, email, avatar_url ),
      reply_to:messages!reply_to_id (
        id, content, type,
        sender:profiles!sender_id ( id, full_name, email, avatar_url )
      )
    `)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data, { status: 201 })
}
