"use client"

import { useEffect, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import type { Message, MessageReaction, TypingUser } from "@/lib/types"

interface UseConversationRealtimeOptions {
  conversationId: string | null
  onNewMessage: (msg: Message) => void
  onMessageUpdated: (msg: Partial<Message> & { id: string }) => void
  onReactionChange: (reaction: MessageReaction & { action: "added" | "removed" }) => void
  onTyping: (users: TypingUser[]) => void
}

export function useConversationRealtime({
  conversationId,
  onNewMessage,
  onMessageUpdated,
  onReactionChange,
  onTyping,
}: UseConversationRealtimeOptions) {
  const supabase = createClient()
  // Keep stable refs so the effect doesn't re-subscribe on every render
  const onNewMessageRef = useRef(onNewMessage)
  const onMessageUpdatedRef = useRef(onMessageUpdated)
  const onReactionChangeRef = useRef(onReactionChange)
  const onTypingRef = useRef(onTyping)

  onNewMessageRef.current = onNewMessage
  onMessageUpdatedRef.current = onMessageUpdated
  onReactionChangeRef.current = onReactionChange
  onTypingRef.current = onTyping

  useEffect(() => {
    if (!conversationId) return

    const channel = supabase
      .channel(`conv:${conversationId}`)
      // New messages via postgres_changes
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          onNewMessageRef.current(payload.new as Message)
        },
      )
      // Message edits / soft-deletes
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          onMessageUpdatedRef.current(payload.new as Partial<Message> & { id: string })
        },
      )
      // Reactions (INSERT)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "message_reactions",
        },
        (payload) => {
          onReactionChangeRef.current({ ...(payload.new as MessageReaction), action: "added" })
        },
      )
      // Reactions (DELETE)
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "message_reactions",
        },
        (payload) => {
          onReactionChangeRef.current({ ...(payload.old as MessageReaction), action: "removed" })
        },
      )
      // Typing broadcast (zero DB writes, ultra-low latency)
      .on(
        "broadcast",
        { event: "typing" },
        (payload) => {
          const { users } = payload.payload as { users: TypingUser[] }
          onTypingRef.current(users ?? [])
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [conversationId, supabase])
}
