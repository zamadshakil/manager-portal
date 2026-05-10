"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { ChevronLeft, Info, Users } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { useIsBelowDesktop } from "@/hooks/use-mobile"
import { MessageList, type MessageListHandle, ESTIMATED_ITEM_SIZE } from "./message-list"
import { MessageComposer } from "./message-composer"
import { TypingIndicator } from "./typing-indicator"
import { useConversationRealtime } from "@/hooks/use-conversation-realtime"
import type { Conversation, Message, MessageReaction, TypingUser, Profile } from "@/lib/types"
import { GroupInfoSheet } from "./group-info-sheet"
import { DmInfoSheet } from "./dm-info-sheet"

interface ConversationViewProps {
  conversation: Conversation
  currentUserId: string
  currentUserName: string
  profiles: Profile[]
  onBack?: () => void
  onConversationUpdate?: (patch: Partial<Pick<Conversation, "name" | "avatar_url">>) => void
  onLastMessage?: (conversationId: string, message: Message) => void
  onConversationHidden?: (conversationId: string) => void
}

function mergeReplyMessage(
  replyTo: Message["reply_to"] | undefined,
  fallback: Message | null = null,
): Message["reply_to"] {
  if (replyTo == null) return fallback
  if (!fallback) return replyTo
  return {
    ...fallback,
    ...replyTo,
    sender: replyTo.sender ?? fallback.sender,
    reactions: replyTo.reactions ?? fallback.reactions,
  }
}

export function ConversationView({
  conversation,
  currentUserId,
  currentUserName,
  profiles,
  onBack,
  onConversationUpdate,
  onLastMessage,
  onConversationHidden,
}: ConversationViewProps) {
  const isBelowDesktop = useIsBelowDesktop()
  // Stable ref so callbacks never need to re-close over onLastMessage
  const onLastMessageRef = useRef(onLastMessage)
  useEffect(() => { onLastMessageRef.current = onLastMessage }, [onLastMessage])
  // Compute validity flag BEFORE hooks — used as a conditional render guard
  // at the bottom of the function.  We cannot do an early return here because
  // all hooks below must be called unconditionally (Rules of Hooks).
  const isInvalidConversation = !conversation.id || typeof conversation.id !== "string"

  const [messages, setMessages] = useState<Message[]>([])
  const [loadingInitial, setLoadingInitial] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([])
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const replyToRef = useRef<Message | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const listRef = useRef<MessageListHandle>(null)

  useEffect(() => {
    replyToRef.current = replyTo
  }, [replyTo])

  const fetchMessages = useCallback(async (before?: string) => {
    const params = new URLSearchParams({ conv: conversation.id, limit: "50" })
    if (before) params.set("before", before)
    const res = await fetch(`/api/messaging/messages?${params}`)
    if (!res.ok) throw new Error("Failed to load messages")
    return res.json() as Promise<Message[]>
  }, [conversation.id])

  // Resolve reply_to (and reply_to.sender) from a local pool when the DB join returned null.
  // Supabase double-nested joins (sender inside reply_to) can return null even when data
  // exists — patch from the locally-cached message when that happens.
  const patchReplyTos = useCallback((msgs: Message[], pool: Message[]): Message[] => {
    const byId = new Map(pool.map((m) => [m.id, m]))
    return msgs.map((m) => {
      if (!m.reply_to_id) return m
      return { ...m, reply_to: mergeReplyMessage(m.reply_to, byId.get(m.reply_to_id) ?? null) }
    })
  }, [])

  // Initial load
  useEffect(() => {
    setLoadingInitial(true)
    setMessages([])
    setHasMore(true)
    fetchMessages()
      .then((data) => {
        setMessages(patchReplyTos(data, data))
        setHasMore(data.length === 50)
      })
      .catch(() => toast.error("Failed to load messages"))
      .finally(() => setLoadingInitial(false))
  }, [fetchMessages, patchReplyTos])

  // Mark the conversation as read — only when the tab is focused AND the user
  // is at (or near) the bottom of the list.  Calling it when scrolled up or
  // with the tab in the background would incorrectly zero the unread counter.
  const markRead = useCallback(() => {
    if (!document.hasFocus()) return
    if (!listRef.current?.isAtBottom()) return
    fetch(`/api/messaging/conversations/${conversation.id}/read`, { method: "POST" }).catch(() => {})
  }, [conversation.id]) // listRef is a stable ref; isAtBottom reads from isAtBottomRef at call-time

  // Trigger on new messages arriving while the user is already at the bottom
  useEffect(() => {
    if (messages.length === 0) return
    markRead()
  }, [conversation.id, messages.length, markRead])

  // Re-check when the user returns to this tab (focus or visibility change)
  useEffect(() => {
    const onFocus = () => markRead()
    const onVisible = () => { if (!document.hidden) markRead() }
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [markRead])

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !hasMore || messages.length === 0) return
    setLoadingMore(true)
    // Capture scroll position before prepending so react-window's virtual
    // layout shift doesn't jump the viewport to a different message.
    const prevOffset = listRef.current?.getScrollOffset() ?? 0
    try {
      const oldest = messages[0]?.created_at
      const older = await fetchMessages(oldest)
      // New items are unmeasured; use the same estimate react-window uses.
      const addedHeight = older.length * ESTIMATED_ITEM_SIZE
      setMessages((prev) => {
        const combined = [...older, ...prev]
        return [...patchReplyTos(older, combined), ...prev]
      })
      setHasMore(older.length === 50)
      // Two rAFs: first waits for React to commit new items to the DOM;
      // second waits for react-window to recalculate the virtual layout.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          listRef.current?.scrollToOffset(prevOffset + addedHeight)
        })
      })
    } catch {
      toast.error("Failed to load older messages")
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, messages, fetchMessages, patchReplyTos])

  // Realtime: new message from Supabase
  const handleNewMessage = useCallback((msg: Message) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev
      // Resolve reply_to from existing state when join returned null.
      // Also fill in a missing sender from the locally-cached copy of the
      // reply target so the preview never shows "Unknown".
      const localReplyMsg = msg.reply_to_id ? (prev.find((m) => m.id === msg.reply_to_id) ?? null) : null
      const replyTo = mergeReplyMessage(msg.reply_to, localReplyMsg)
      return [...prev, { ...msg, reply_to: replyTo }]
    })
    // Instantly update sidebar preview for this conversation
    onLastMessageRef.current?.(msg.conversation_id, msg)
  }, [])

  const handleMessageUpdated = useCallback((partial: Partial<Message> & { id: string }) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== partial.id) return m
        // Preserve joined fields (reply_to, sender, reactions) that raw DB rows omit.
        // Supabase nested joins can return null for reply_to even when the data exists;
        // never overwrite a populated reply_to with null from the server.
        const incomingReplyTo = partial.reply_to
        const mergedReplyTo = incomingReplyTo !== undefined
          ? mergeReplyMessage(incomingReplyTo, m.reply_to ?? null)
          : m.reply_to
        return {
          ...m,
          ...partial,
          reply_to: mergedReplyTo,
          sender:   partial.sender   !== undefined ? partial.sender   : m.sender,
          reactions: partial.reactions !== undefined ? partial.reactions : m.reactions,
        }
      }),
    )
  }, [])

  const handleReactionChange = useCallback(
    (reaction: MessageReaction & { action: "added" | "removed" | "updated" }) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== reaction.message_id) return m
          const reactions = m.reactions ?? []
          if (reaction.action === "removed") {
            return { ...m, reactions: reactions.filter((r) => !(r.user_id === reaction.user_id && r.emoji === reaction.emoji)) }
          }

          const nextReactions = reactions.filter((r) => r.user_id !== reaction.user_id)
          if (
            nextReactions.length === reactions.length - 1 &&
            reactions.some((r) => r.user_id === reaction.user_id && r.emoji === reaction.emoji)
          ) {
            return m
          }
          return { ...m, reactions: [...nextReactions, reaction] }
        }),
      )
    },
    [],
  )

  const handleTypingBroadcast = useCallback((users: TypingUser[]) => {
    const others = users.filter((u) => u.userId !== currentUserId)
    setTypingUsers(others)
  }, [currentUserId])

  useConversationRealtime({
    conversationId: conversation.id,
    onNewMessage: handleNewMessage,
    onMessageUpdated: handleMessageUpdated,
    onReactionChange: handleReactionChange,
    onTyping: handleTypingBroadcast,
  })

  // Optimistic send
  const handleSend = useCallback(async (payload: {
    content?: string
    type: string
    media_url?: string
    media_metadata?: Record<string, unknown>
    reply_to_id?: string
  }) => {
    const tmpId = `tmp_${crypto.randomUUID()}`
    const requestedReplyId = payload.reply_to_id ?? replyToRef.current?.id ?? null
    const persistedReplyId = requestedReplyId && !requestedReplyId.startsWith("tmp_")
      ? requestedReplyId
      : null
    const replyTarget = persistedReplyId
      ? (messages.find((message) => message.id === persistedReplyId) ?? null)
      : null
    const optimistic: Message = {
      id: tmpId,
      conversation_id: conversation.id,
      sender_id: currentUserId,
      sender: {
        id: currentUserId,
        full_name: currentUserName || null,
        email: "",
        avatar_url: null,
      },
      content: payload.content ?? null,
      type: payload.type as Message["type"],
      media_url: payload.media_url ?? null,
      media_metadata: payload.media_metadata ?? null,
      reply_to_id: persistedReplyId,
      reply_to: replyTarget,
      edited_at: null,
      deleted_at: null,
      created_at: new Date().toISOString(),
      status: "sending",
    }
    setMessages((prev) => [...prev, optimistic])
    requestAnimationFrame(() => listRef.current?.scrollToBottom("auto"))
    // Optimistically update the sidebar last-message preview right away
    onLastMessageRef.current?.(conversation.id, optimistic)

    try {
      const res = await fetch("/api/messaging/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversation.id,
          ...payload,
          reply_to_id: persistedReplyId,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      const real: Message = await res.json()
      // Update sidebar with the confirmed server message (correct id + timestamp)
      onLastMessageRef.current?.(conversation.id, real)
      setMessages((prev) => {
        const optimisticMsg = prev.find((m) => m.id === tmpId)
        // Merge reply_to: prefer API data but fall back to the locally-known
        // snapshot when the Supabase nested join returns null for sender/content.
        const apiReplyTo  = real.reply_to
        const localReplyTo = optimisticMsg?.reply_to
        const replyTo = mergeReplyMessage(apiReplyTo, localReplyTo ?? null)
        // Realtime may have delivered the real row before the POST response
        // arrived and already added it to state. If so, just drop the tmp
        // placeholder to avoid having two copies of the same message.
        if (prev.some((m) => m.id === real.id)) {
          // Patch sender on the already-present real message too, in case the
          // realtime / poll copy also had a null nested-join sender.
          return prev
            .filter((m) => m.id !== tmpId)
            .map((m) => {
              if (m.id !== real.id) return m
              const existingReplyTo = m.reply_to
              return {
                ...m,
                reply_to: mergeReplyMessage(existingReplyTo, replyTo ?? null),
              }
            })
        }
        return prev.map((m) => (m.id === tmpId ? { ...real, reply_to: replyTo, status: "sent" } : m))
      })
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === tmpId ? { ...m, status: "failed" } : m)),
      )
      toast.error("Failed to send message")
    }
  }, [conversation.id, currentUserId, currentUserName, messages])

  const handleRetry = useCallback((msg: Message) => {
    // Remove failed message and resend
    setMessages((prev) => prev.filter((m) => m.id !== msg.id))
    handleSend({
      content: msg.content ?? undefined,
      type: msg.type,
      media_url: msg.media_url ?? undefined,
      media_metadata: msg.media_metadata ?? undefined,
      reply_to_id: msg.reply_to_id ?? undefined,
    })
  }, [handleSend])

  const handleReact = useCallback(async (msgId: string, emoji: string) => {
    await fetch(`/api/messaging/messages/${msgId}/reactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji }),
    })
  }, [])

  const handleEdit = useCallback((msg: Message, newContent: string) => {
    if (!newContent.trim() || newContent === msg.content) return
    setMessages((prev) =>
      prev.map((m) => m.id === msg.id ? { ...m, content: newContent, edited_at: new Date().toISOString() } : m)
    )
    fetch(`/api/messaging/messages/${msg.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: newContent }),
    })
      .then((r) => r.ok ? r.json() : Promise.reject(r))
      .then((updated: Message) =>
        setMessages((prev) => prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m))),
      )
      .catch(() => toast.error("Failed to edit message"))
  }, [])

  const handleDelete = useCallback(async (msgId: string) => {
    await fetch(`/api/messaging/messages/${msgId}`, { method: "DELETE" })
    setMessages((prev) =>
      prev.map((m) => m.id === msgId ? { ...m, deleted_at: new Date().toISOString() } : m),
    )
  }, [])

  const handleClearHistory = useCallback(async () => {
    const res = await fetch(`/api/messaging/conversations/${conversation.id}/clear`, { method: "POST" })
    if (res.ok) {
      setMessages([])
    } else {
      toast.error("Failed to clear history")
    }
  }, [conversation.id])

  const handleHideConversation = useCallback(async () => {
    const res = await fetch(`/api/messaging/conversations/${conversation.id}/hide`, { method: "POST" })
    if (res.ok) {
      onConversationHidden?.(conversation.id)
    } else {
      toast.error("Failed to delete conversation")
    }
  }, [conversation.id, onConversationHidden])

  // Typing indicator debounce
  const sendTyping = useCallback(() => {
    fetch("/api/messaging/typing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conv: conversation.id, name: currentUserName }),
    }).catch(() => {})
  }, [conversation.id, currentUserName])

  // Conversation header info
  const isGroup = conversation.type === "group"
  const otherMember = isGroup ? null : conversation.members?.find((m) => m.user_id !== currentUserId)
  const otherMemberDeleted = !isGroup && !!(otherMember?.profile as any)?.deleted_at
  const isOtherOnline = usePresence(isGroup ? null : (otherMember?.user_id ?? null))
  const headerName = isGroup
    ? (conversation.name ?? "Group")
    : (otherMember?.profile?.full_name ?? otherMember?.profile?.email ?? "DM")
  const headerAvatarSrc = isGroup
    ? (conversation.avatar_url ?? undefined)
    : (otherMember?.profile?.avatar_url ?? undefined)
  const headerInitials = headerName.slice(0, 2).toUpperCase()
  const memberCount = (conversation.members ?? []).filter(
    (m) => !m.removed_at && !m.profile?.deleted_at
  ).length

  if (isInvalidConversation) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Invalid conversation
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0 bg-background/95 backdrop-blur-sm shadow-sm">
        <div className="flex items-center gap-3">
          {isBelowDesktop && onBack ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              aria-label="Back to conversations"
              title="Back to conversations"
              className="shrink-0"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          ) : null}
          <div className="relative">
            <Avatar className="h-9 w-9">
              <AvatarImage src={headerAvatarSrc} alt={headerName} />
              <AvatarFallback className="text-[11px] font-semibold">{headerInitials}</AvatarFallback>
            </Avatar>
            {!isGroup && !otherMemberDeleted && isOtherOnline && (
              <span
                className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2 border-background"
                aria-label="Online"
                title="Online"
              />
            )}
            {isGroup && (
              <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-background border border-border p-0.5">
                <Users className="h-2.5 w-2.5 text-muted-foreground" aria-hidden="true" />
              </span>
            )}
          </div>
          <div>
            <p className="text-[14px] font-semibold leading-tight">{headerName}</p>
            {isGroup ? (
              <p className="text-[11px] text-muted-foreground">{memberCount} member{memberCount !== 1 ? "s" : ""}</p>
            ) : otherMemberDeleted ? (
              <p className="text-[11px] text-muted-foreground italic">User removed</p>
            ) : isOtherOnline ? (
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">Active now</p>
            ) : (
              <p className="text-[11px] text-muted-foreground">Offline</p>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setInfoOpen(true)}
          aria-label={isGroup ? "Group info" : "Conversation info"}
          title={isGroup ? "Group info" : "Conversation info"}
        >
          <Info className="h-4 w-4" />
        </Button>
      </div>

      {/* Messages */}
      {loadingInitial ? (
        <div className="flex-1 overflow-hidden px-4 py-3 flex flex-col gap-3">
          <MessageSkeleton isOwn={false} width="w-48" />
          <MessageSkeleton isOwn={false} width="w-64" />
          <MessageSkeleton isOwn={true} width="w-52" />
          <MessageSkeleton isOwn={false} width="w-40" />
          <MessageSkeleton isOwn={true} width="w-72" />
          <MessageSkeleton isOwn={true} width="w-36" />
          <MessageSkeleton isOwn={false} width="w-56" />
        </div>
      ) : (
        <MessageList
          ref={listRef}
          messages={messages}
          currentUserId={currentUserId}
          loadingMore={loadingMore}
          hasMore={hasMore}
          onLoadMore={handleLoadMore}
          onReact={handleReact}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onReply={setReplyTo}
          onRetry={handleRetry}
          onScrolledToBottom={markRead}
        />
      )}

      <TypingIndicator users={typingUsers} />

      {otherMemberDeleted ? (
        <div className="shrink-0 px-4 py-3 border-t border-border bg-muted/40 text-center">
          <p className="text-xs text-muted-foreground">
            This user has been removed and can no longer receive messages.
          </p>
        </div>
      ) : (
        <MessageComposer
          conversationId={conversation.id}
          replyTo={replyTo}
          onClearReply={() => setReplyTo(null)}
          onSend={handleSend}
          onTyping={sendTyping}
        />
      )}

      {isGroup ? (
        <GroupInfoSheet
          open={infoOpen}
          conversation={conversation}
          currentUserId={currentUserId}
          profiles={profiles}
          onClose={() => setInfoOpen(false)}
          onClearHistory={handleClearHistory}
          onGroupUpdated={onConversationUpdate}
          onHideConversation={handleHideConversation}
        />
      ) : (
        <DmInfoSheet
          open={infoOpen}
          conversation={conversation}
          currentUserId={currentUserId}
          onClose={() => setInfoOpen(false)}
          onClearHistory={handleClearHistory}
          onHideConversation={handleHideConversation}
        />
      )}
    </div>
  )
}

// ── Presence hook ────────────────────────────────────────────────────────────
// Polls GET /api/messaging/presence every 30 s (matching the heartbeat TTL).
// Returns false while loading so we never flash "online" incorrectly.
function usePresence(userId: string | null): boolean {
  const [online, setOnline] = useState(false)

  useEffect(() => {
    if (!userId) {
      setOnline(false)
      return
    }

    let active = true

    async function check() {
      if (!active) return
      try {
        const res = await fetch(
          `/api/messaging/presence?userIds=${encodeURIComponent(userId!)}`,
          { cache: "no-store" },
        )
        if (!res.ok || !active) return
        const map: Record<string, boolean> = await res.json()
        if (active) setOnline(map[userId!] === true)
      } catch {
        // silent — keep last known state
      }
    }

    check()
    const timer = setInterval(check, 30_000)

    return () => {
      active = false
      clearInterval(timer)
    }
  }, [userId])

  return online
}

function MessageSkeleton({ isOwn, width }: { isOwn: boolean; width: string }) {
  return (
    <div className={cn("flex items-end gap-2", isOwn ? "flex-row-reverse" : "flex-row")}>
      <div className="h-7 w-7 rounded-full bg-muted animate-pulse shrink-0" />
      <div
        className={cn(
          "h-9 rounded-2xl bg-muted animate-pulse",
          width,
          isOwn ? "rounded-tr-sm" : "rounded-tl-sm",
        )}
      />
    </div>
  )
}
