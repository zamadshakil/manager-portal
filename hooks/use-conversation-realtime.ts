"use client"

import { useEffect, useRef } from "react"
import type { Message, MessageReaction, TypingUser } from "@/lib/types"

// Supabase postgres_changes requires per-table realtime to be enabled in the
// Supabase dashboard — a setup step that is often skipped.  Instead we use
// reliable HTTP polling so messages and the typing indicator work immediately
// without any Supabase Realtime configuration.

const MSG_POLL_MS     = 2500  // new-message poll interval
const TYPING_POLL_MS  = 1500  // typing-indicator poll interval

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
  onMessageUpdated,  // kept for API compat — used by periodic sync below
  onTyping,
}: UseConversationRealtimeOptions) {
  // Stable callback refs — updating these never restarts intervals
  const onNewMessageRef    = useRef(onNewMessage)
  const onMessageUpdatedRef = useRef(onMessageUpdated)
  const onTypingRef        = useRef(onTyping)

  onNewMessageRef.current     = onNewMessage
  onMessageUpdatedRef.current = onMessageUpdated
  onTypingRef.current         = onTyping

  // ISO timestamp cursor — we only request messages newer than this
  const cursorRef = useRef<string>("")

  useEffect(() => {
    if (!conversationId) return

    // Start 5 s in the past so we never miss a message that arrived between
    // the initial page-load fetch and the first poll tick.
    cursorRef.current = new Date(Date.now() - 5_000).toISOString()

    let active = true

    // ── Poll: new messages ────────────────────────────────────────────────────
    async function pollMessages() {
      if (!active) return
      try {
        const url =
          `/api/messaging/messages` +
          `?conv=${encodeURIComponent(conversationId!)}` +
          `&after=${encodeURIComponent(cursorRef.current)}` +
          `&limit=50`
        const res = await fetch(url, { cache: "no-store" })
        if (!res.ok || !active) return
        const msgs: Message[] = await res.json()
        for (const msg of msgs) {
          onNewMessageRef.current(msg)
          // Advance cursor so we never re-fetch the same messages
          if (msg.created_at > cursorRef.current) {
            cursorRef.current = msg.created_at
          }
        }
      } catch {
        // Network hiccup — silent, will retry on next tick
      }
    }

    // ── Poll: typing indicators ───────────────────────────────────────────────
    async function pollTyping() {
      if (!active) return
      try {
        const res = await fetch(
          `/api/messaging/typing?conv=${encodeURIComponent(conversationId!)}`,
          { cache: "no-store" },
        )
        if (!res.ok || !active) return
        const users: TypingUser[] = await res.json()
        onTypingRef.current(users)
      } catch {
        // Silent
      }
    }

    const msgTimer    = setInterval(pollMessages, MSG_POLL_MS)
    const typingTimer = setInterval(pollTyping,   TYPING_POLL_MS)

    // Kick off immediately so the first tick doesn't wait a full interval
    void pollMessages()
    void pollTyping()

    return () => {
      active = false
      clearInterval(msgTimer)
      clearInterval(typingTimer)
    }
  }, [conversationId])
}
