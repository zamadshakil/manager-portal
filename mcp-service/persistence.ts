import { createClient, SupabaseClient } from "@supabase/supabase-js"

/**
 * Chat persistence layer for the MCP service.
 *
 * The mcp-service runs server-side on Railway and is a *trusted* service
 * (it holds MCP_SERVICE_TOKEN and is the only thing the portal calls). It
 * needs to persist messages even when there is no live user JWT — e.g.
 * during long-running tool calls where the access token may have expired
 * mid-stream — so we use the service-role key here.
 *
 * RLS is still enforced for any other client (the Next.js portal, the
 * Supabase Studio, etc.) because we never expose this client to the
 * browser.
 *
 * The schema is the one created by `chat-system-database-design` plus the
 * follow-up migration in `scripts/smart-ai-chat-followup.sql`:
 *
 *   chat_threads  (id, user_id, title, created_at, updated_at)
 *   chat_messages (id, thread_id, role, content, metadata, created_at)
 */

export interface Message {
  role: "user" | "assistant" | "system"
  content: string
  metadata?: Record<string, any>
}

export class ChatPersistence {
  private supabase: SupabaseClient
  private mode: "service_role" | "user_jwt" | "anon"

  constructor(accessToken: string | null) {
    const supabaseUrl = process.env.SUPABASE_URL ?? ""
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
    const anonKey = process.env.SUPABASE_ANON_KEY ?? ""

    if (!supabaseUrl) {
      throw new Error(
        "[persistence] SUPABASE_URL is required. Set it on the mcp-service Railway environment.",
      )
    }

    // Prefer service-role on the server. Fall back to user JWT (still
    // RLS-restricted) and finally anon (read-only public). The fallbacks
    // mostly exist so local dev keeps working without secrets.
    if (serviceRoleKey) {
      this.mode = "service_role"
      this.supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    } else if (accessToken && anonKey) {
      this.mode = "user_jwt"
      this.supabase = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      })
      console.warn(
        "[persistence] Using user JWT — set SUPABASE_SERVICE_ROLE_KEY for production.",
      )
    } else {
      this.mode = "anon"
      this.supabase = createClient(supabaseUrl, anonKey || "anon", {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      console.warn(
        "[persistence] No service-role key and no user JWT — persistence will likely fail under RLS.",
      )
    }
  }

  async getMessages(threadId: string, limit = 30): Promise<Message[]> {
    const { data, error } = await this.supabase
      .from("chat_messages")
      .select("role, content, metadata")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(limit)

    if (error) {
      console.error("[persistence] getMessages failed:", error.message)
      return []
    }

    return (data ?? []).map((row: any) => ({
      role: row.role,
      content: row.content,
      metadata: row.metadata ?? {},
    }))
  }

  async saveMessage(threadId: string, message: Message): Promise<void> {
    if (!message.content && !message.metadata) return

    const { error } = await this.supabase.from("chat_messages").insert({
      thread_id: threadId,
      role: message.role,
      content: message.content ?? "",
      metadata: message.metadata ?? {},
    })

    if (error) {
      // Log loudly but don't throw — losing a single message must not
      // crash the live stream the user is watching.
      console.error("[persistence] saveMessage failed:", {
        mode: this.mode,
        role: message.role,
        message: error.message,
        code: error.code,
        details: error.details,
        threadId,
      })
    }
  }

  /**
   * Find or create a chat thread. If the caller passes a `threadId` we
   * verify it exists and belongs to the user. If not, we mint a new one.
   */
  async ensureThread(userId: string, threadId?: string | null): Promise<string> {
    if (threadId) {
      const { data: existing, error: lookupErr } = await this.supabase
        .from("chat_threads")
        .select("id")
        .eq("id", threadId)
        .eq("user_id", userId)
        .maybeSingle()

      if (!lookupErr && existing?.id) {
        return existing.id
      }

      // Thread doesn't exist (or belongs to someone else under service
      // role) — create one with the requested ID so the client's
      // localStorage stays in sync.
      const { data: created, error: insertErr } = await this.supabase
        .from("chat_threads")
        .insert({ id: threadId, user_id: userId, title: "New conversation" })
        .select("id")
        .single()

      if (!insertErr && created?.id) {
        return created.id
      }

      // Fall through to a server-generated ID if even that failed.
      console.error("[persistence] ensureThread reuse failed:", {
        message: insertErr?.message,
        code: insertErr?.code,
        threadId,
      })
    }

    const { data, error } = await this.supabase
      .from("chat_threads")
      .insert({ user_id: userId, title: "New conversation" })
      .select("id")
      .single()

    if (error || !data) {
      console.error("[persistence] ensureThread create failed:", {
        message: error?.message,
        code: error?.code,
        details: error?.details,
        hint: error?.hint,
      })
      throw new Error(`Failed to create chat thread: ${error?.message || "Unknown error"}`)
    }
    return data.id
  }
}
