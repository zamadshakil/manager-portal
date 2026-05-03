import { createClient, SupabaseClient } from "@supabase/supabase-js"

export interface Message {
  role: "user" | "assistant" | "system"
  content: string
  metadata?: any
}

export class ChatPersistence {
  private supabase: SupabaseClient

  constructor(accessToken: string | null) {
    const supabaseUrl = process.env.SUPABASE_URL || ""
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || ""
    
    this.supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      },
    })
  }

  async getMessages(threadId: string, limit = 20): Promise<Message[]> {
    const { data, error } = await this.supabase
      .from("chat_messages")
      .select("role, content, metadata")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(limit)

    if (error) {
      console.error("[persistence] Error fetching messages:", error)
      return []
    }

    return (data || []) as Message[]
  }

  async saveMessage(threadId: string, message: Message) {
    const { error } = await this.supabase
      .from("chat_messages")
      .insert({
        thread_id: threadId,
        role: message.role,
        content: message.content,
        metadata: message.metadata || {},
      })

    if (error) {
      console.error("[persistence] Error saving message:", error)
    }
  }

  async ensureThread(userId: string, threadId?: string): Promise<string> {
    if (threadId) return threadId

    const { data, error } = await this.supabase
      .from("chat_threads")
      .insert({ user_id: userId, title: "New Conversation" })
      .select("id")
      .single()

    if (error) {
      console.error("[persistence] Error creating thread:", error)
      throw new Error("Failed to create chat thread")
    }

    return data.id
  }
}
