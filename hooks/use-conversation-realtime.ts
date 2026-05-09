"use client"

import { useEffect, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import type { Message, MessageReaction, TypingUser } from "@/lib/types"

// Poll intervals — kept active for reliability.
// Realtime can be "SUBSCRIBED" yet not deliver DB events if publication is
// misconfigured, so polling remains the guaranteed delivery path.
const MSG_POLL_MS    = 2000
const MOD_POLL_MS    = 3000
const REACT_POLL_MS  = 2500
const TYPING_POLL_MS = 1500
const FULL_SYNC_MS   = 30_000

interface UseConversationRealtimeOptions {
  conversationId: string | null
  onNewMessage: (msg: Message) => void
  onMessageUpdated: (msg: Partial<Message> & { id: string }) => void
  onReactionChange: (reaction: MessageReaction & { action: "added" | "removed" | "updated" }) => void
  onTyping: (users: TypingUser[]) => void
}

export function useConversationRealtime({
  conversationId,
  onNewMessage,
  onMessageUpdated,
  onReactionChange,
  onTyping,
}: UseConversationRealtimeOptions) {
  // Stable callback refs — updating these never restarts the effect
  const onNewMessageRef     = useRef(onNewMessage)
  const onMessageUpdatedRef = useRef(onMessageUpdated)
  const onReactionChangeRef = useRef(onReactionChange)
  const onTypingRef         = useRef(onTyping)

  onNewMessageRef.current     = onNewMessage
  onMessageUpdatedRef.current = onMessageUpdated
  onReactionChangeRef.current = onReactionChange
  onTypingRef.current         = onTyping

  useEffect(() => {
    if (!conversationId) return

    const startTs = new Date(Date.now() - 5_000).toISOString()
    // Cursors track the latest timestamp seen per data type
    let msgCursor   = startTs
    let modCursor   = startTs
    let reactCursor = startTs

    let active          = true
    let realtimeActive  = false

    // ── Fetch helpers ─────────────────────────────────────────────────────────

    async function fetchNewMessages() {
      if (!active) return
      try {
        const url =
          `/api/messaging/messages` +
          `?conv=${encodeURIComponent(conversationId!)}` +
          `&after=${encodeURIComponent(msgCursor)}` +
          `&limit=50`
        const res = await fetch(url, { cache: "no-store" })
        if (!res.ok || !active) return
        const msgs: Message[] = await res.json()
        for (const msg of msgs) {
          onNewMessageRef.current(msg)
          if (msg.created_at > msgCursor) msgCursor = msg.created_at
        }
      } catch { /* silent — will retry */ }
    }

    async function fetchModified() {
      if (!active) return
      try {
        const url =
          `/api/messaging/messages` +
          `?conv=${encodeURIComponent(conversationId!)}` +
          `&modifiedAfter=${encodeURIComponent(modCursor)}` +
          `&limit=50`
        const res = await fetch(url, { cache: "no-store" })
        if (!res.ok || !active) return
        const msgs: Message[] = await res.json()
        for (const msg of msgs) {
          onMessageUpdatedRef.current(msg)
          const ts = msg.edited_at ?? msg.deleted_at ?? msg.created_at
          if (ts > modCursor) modCursor = ts
        }
      } catch { /* silent */ }
    }

    async function fetchReactions() {
      if (!active) return
      try {
        const url =
          `/api/messaging/conversations/${conversationId}/reactions` +
          `?after=${encodeURIComponent(reactCursor)}`
        const res = await fetch(url, { cache: "no-store" })
        if (!res.ok || !active) return
        const items: (MessageReaction & { action: "added" | "removed" })[] = await res.json()
        for (const r of items) {
          onReactionChangeRef.current(r)
          if (r.created_at > reactCursor) reactCursor = r.created_at
        }
      } catch { /* silent */ }
    }

    async function fetchTyping() {
      if (!active) return
      try {
        const res = await fetch(
          `/api/messaging/typing?conv=${encodeURIComponent(conversationId!)}`,
          { cache: "no-store" },
        )
        if (!res.ok || !active) return
        const users: TypingUser[] = await res.json()
        onTypingRef.current(users)
      } catch { /* silent */ }
    }

    async function fullSync() {
      // Always run, even when Realtime is connected.
      // Realtime DELETE events for message_reactions can be dropped during
      // brief network blips; without this periodic resync a removed reaction
      // would stay visible in the UI indefinitely. The message GET response
      // includes the full reactions join, so handleMessageUpdated will
      // overwrite any stale reaction state with the authoritative DB value.
      if (!active) return
      try {
        const url =
          `/api/messaging/messages` +
          `?conv=${encodeURIComponent(conversationId!)}` +
          `&limit=50`
        const res = await fetch(url, { cache: "no-store" })
        if (!res.ok || !active) return
        const msgs: Message[] = await res.json()
        for (const msg of msgs) onMessageUpdatedRef.current(msg)
      } catch { /* silent */ }
    }

    // ── Polling timers (always-on reliability path) ───────────────────────────

    let msgTimer:      ReturnType<typeof setInterval> | null = null
    let modTimer:      ReturnType<typeof setInterval> | null = null
    let reactTimer:    ReturnType<typeof setInterval> | null = null
    let typingTimer:   ReturnType<typeof setInterval> | null = null
    let fullSyncTimer: ReturnType<typeof setInterval> | null = null

    function startPolling() {
      realtimeActive = false
      if (!msgTimer)      msgTimer      = setInterval(fetchNewMessages, MSG_POLL_MS)
      if (!modTimer)      modTimer      = setInterval(fetchModified,    MOD_POLL_MS)
      if (!reactTimer)    reactTimer    = setInterval(fetchReactions,   REACT_POLL_MS)
      if (!fullSyncTimer) fullSyncTimer = setInterval(fullSync,         FULL_SYNC_MS)
      void fetchNewMessages()
      void fetchModified()
      void fetchReactions()
    }

    function stopPolling() {
      if (msgTimer)      { clearInterval(msgTimer);      msgTimer      = null }
      if (modTimer)      { clearInterval(modTimer);      modTimer      = null }
      if (reactTimer)    { clearInterval(reactTimer);    reactTimer    = null }
      if (fullSyncTimer) { clearInterval(fullSyncTimer); fullSyncTimer = null }
    }

    // Typing always uses HTTP (Redis-backed, not in Realtime publication)
    typingTimer = setInterval(fetchTyping, TYPING_POLL_MS)
    void fetchTyping()

    // ── Supabase Realtime ─────────────────────────────────────────────────────

    const supabase = createClient()

    const channel = supabase
      .channel(`conv:${conversationId}`)
      .on(
        "postgres_changes" as any,
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          // Realtime INSERT payload lacks joined data — use fetch to get full message
          if (active) void fetchNewMessages()
        },
      )
      .on(
        "postgres_changes" as any,
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload: any) => {
          if (!active) return
          onMessageUpdatedRef.current(payload.new as Message)
        },
      )
      .on(
        "postgres_changes" as any,
        {
          event: "INSERT",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload: any) => {
          if (!active) return
          const r = payload.new as MessageReaction
          onReactionChangeRef.current({ ...r, action: "added" })
        },
      )
      .on(
        "postgres_changes" as any,
        {
          event: "UPDATE",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload: any) => {
          if (!active) return
          const r = payload.new as MessageReaction
          onReactionChangeRef.current({ ...r, action: "updated" })
        },
      )
      .on(
        "postgres_changes" as any,
        {
          event: "DELETE",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload: any) => {
          if (!active) return
          const r = payload.old as MessageReaction
          onReactionChangeRef.current({ ...r, action: "removed" })
        },
      )
      .subscribe((status: string) => {
        if (!active) return
        if (status === "SUBSCRIBED") {
          realtimeActive = true
          // Keep polling active even when subscribed; Realtime is used as an
          // accelerator, not the only source of truth.
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          // Fall back to polling if Realtime drops
          startPolling()
        }
      })

    // Start polling immediately; Realtime accelerates updates when available
    startPolling()

    return () => {
      active = false
      realtimeActive = false
      stopPolling()
      if (typingTimer) clearInterval(typingTimer)
      supabase.removeChannel(channel)
    }
  }, [conversationId])
}
