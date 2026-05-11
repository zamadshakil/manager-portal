"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { MessageSquareDashed } from "lucide-react"
import { toast } from "sonner"
import { useIsBelowDesktop } from "@/hooks/use-mobile"
import { createClient } from "@/lib/supabase/client"
import { ConversationSidebar } from "./conversation-sidebar"
import { ConversationView } from "./conversation-view"
import type { Conversation, Profile } from "@/lib/types"

interface MessagingLayoutProps {
  currentUserId: string
  currentUserName: string
  profiles: Profile[]
}

// Module-level constant — avoids recreating the RegExp on every render.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ConversationMemberInsertPayload = {
  new: {
    user_id: string
    conversation_id?: string
  }
}

export function MessagingLayout({
  currentUserId,
  currentUserName,
  profiles,
}: MessagingLayoutProps) {
  const isBelowDesktop = useIsBelowDesktop()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [conversations, setConversations] = useState<Conversation[]>([])
  // Initialise from URL so the last-opened conversation survives a reload
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("c") ?? null,
  )
  const [loading, setLoading] = useState(true)

  // Sync selected conversation to the URL without adding a browser-history entry.
  // Validates that the id looks like a UUID before writing to avoid junk in URL.
  const selectConversation = useCallback((id: string | null) => {
    setSelectedId(id)
    if (id && UUID_RE.test(id)) {
      router.replace(`/dashboard/messages?c=${id}`, { scroll: false })
    } else {
      router.replace("/dashboard/messages", { scroll: false })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  const presenceRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Stable ref so fetchConversations can zero unread for the active conversation
  // without taking selectedId as a hook dependency (which would restart effects).
  const selectedIdRef = useRef<string | null>(null)

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  // Fetch conversation list and merge into state.
  // When the currently-selected conversation is refreshed from the server its
  // unread_count is forced to 0 (user is actively viewing it) and the richer
  // client-side members array is preserved to avoid flickering.
  const fetchConversations = useCallback(async (showErrorToast = false) => {
    try {
      const res = await fetch("/api/messaging/conversations", { cache: "no-store" })
      if (!res.ok) throw new Error("Failed to load conversations")
      const data: Conversation[] = await res.json()
      setConversations((prev) =>
        (data as Conversation[]).map((fc) => {
          const existing = prev.find((c) => c.id === fc.id)
          if (fc.id === selectedIdRef.current) {
            return {
              ...fc,
              last_message: existing?.last_message?.status === "sending" ? existing.last_message : fc.last_message,
              unread_count: 0,
            }
          }
          return fc
        }),
      )
    } catch {
      if (showErrorToast) toast.error("Could not load conversations")
    }
  }, []) // no deps — uses selectedIdRef instead of selectedId

  // Debounced refresh — coalesces rapid-fire Realtime events into a single
  // fetch 150 ms after the last trigger (reduced from 400 ms for snappier sidebar).
  const refreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleRefresh = useCallback(() => {
    if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current)
    refreshDebounceRef.current = setTimeout(() => void fetchConversations(), 150)
  }, [fetchConversations])

  // Instantly update a conversation's last-message preview without a network
  // round-trip. Called by ConversationView on every send + every received message.
  const handleLastMessage = useCallback((convId: string, message: import("@/lib/types").Message | null) => {
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === convId)
      if (idx === -1) return prev
      const updated = { ...prev[idx], last_message: message }
      if (!message) {
        const next = [...prev]
        next[idx] = updated
        return next
      }
      const next = [...prev]
      next.splice(idx, 1)
      next.unshift(updated)
      return next
    })
  }, [])

  useEffect(() => {
    fetchConversations(true).finally(() => setLoading(false))
  }, [fetchConversations])

  // Authorization guard — runs exactly once after the initial conversation list
  // has loaded. If the URL's ?c= value is not in this user's list the ID is
  // either tampered, belongs to another user's conversation, or the conversation
  // has been hidden/deleted. In all cases: silently clear the URL and state so
  // the user sees "No conversation selected" instead of a blank stuck screen.
  useEffect(() => {
    if (loading || !selectedId) return
    if (selectedId && !conversations.some((c) => c.id === selectedId)) {
      setSelectedId(null)
      router.replace("/dashboard/messages", { scroll: false })
    }
  }, [loading, conversations, selectedId, router])

  // Safety-net poll at 30 s.
  // Realtime is the primary delivery path; this catches any events that slip
  // through when the channel is degraded. 30 s matches the presence heartbeat
  // cadence and avoids a constant per-user background request every 5 s.
  useEffect(() => {
    const timer = setInterval(() => void fetchConversations(), 30_000)
    return () => clearInterval(timer)
  }, [fetchConversations]) // stable — no selectedId dep needed

  useEffect(() => {
    const supabase = createClient()
    let active = true

    const membershipChannel = supabase
      .channel(`sidebar-membership:${currentUserId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "conversation_members",
          filter: `user_id=eq.${currentUserId}`,
        },
        () => {
          if (!active) return
          scheduleRefresh()
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversation_members",
          filter: `user_id=eq.${currentUserId}`,
        },
        () => {
          if (!active) return
          scheduleRefresh()
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "conversation_members",
          filter: `user_id=eq.${currentUserId}`,
        },
        () => {
          if (!active) return
          scheduleRefresh()
        },
      )
      .subscribe()

    return () => {
      active = false
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current)
      supabase.removeChannel(membershipChannel)
    }
  }, [currentUserId, scheduleRefresh])

  useEffect(() => {
    if (!selectedId) return
    const supabase = createClient()
    let active = true

    const channel = supabase
      .channel(`sidebar-selected-members:${selectedId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "conversation_members",
          filter: `conversation_id=eq.${selectedId}`,
        },
        () => {
          if (!active) return
          scheduleRefresh()
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversation_members",
          filter: `conversation_id=eq.${selectedId}`,
        },
        () => {
          if (!active) return
          scheduleRefresh()
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "conversation_members",
          filter: `conversation_id=eq.${selectedId}`,
        },
        () => {
          if (!active) return
          scheduleRefresh()
        },
      )
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [selectedId, scheduleRefresh])

  const conversationIdsKey = conversations.map((conversation) => conversation.id).sort().join(",")

  useEffect(() => {
    if (!conversationIdsKey) return

    const supabase = createClient()
    let active = true
    const channels = conversations.map((conversation) => (
      supabase
        .channel(`sidebar-conversation:${conversation.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `conversation_id=eq.${conversation.id}`,
          },
          () => {
            if (!active) return
            scheduleRefresh()
          },
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "messages",
            filter: `conversation_id=eq.${conversation.id}`,
          },
          () => {
            if (!active) return
            scheduleRefresh()
          },
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "conversations",
            filter: `id=eq.${conversation.id}`,
          },
          () => {
            if (!active) return
            scheduleRefresh()
          },
        )
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            schema: "public",
            table: "conversations",
            filter: `id=eq.${conversation.id}`,
          },
          () => {
            if (!active) return
            setConversations((prev) => prev.filter((item) => item.id !== conversation.id))
            setSelectedId((prev) => {
              if (prev === conversation.id) {
                router.replace("/dashboard/messages", { scroll: false })
                return null
              }
              return prev
            })
          },
        )
        .subscribe()
    ))

    return () => {
      active = false
      channels.forEach((channel) => {
        supabase.removeChannel(channel)
      })
    }
  }, [conversationIdsKey, conversations, router, scheduleRefresh])

  // Presence heartbeat every 30 s
  useEffect(() => {
    const beat = () =>
      fetch("/api/messaging/presence", { method: "POST" }).catch(() => {})
    beat()
    presenceRef.current = setInterval(beat, 30_000)
    return () => {
      if (presenceRef.current) clearInterval(presenceRef.current)
    }
  }, [])

  const selectedConversation = conversations.find((c) => c.id === selectedId) ?? null

  const handleConversationCreated = useCallback((conv: Conversation) => {
    setConversations((prev) => {
      if (prev.some((c) => c.id === conv.id)) return prev
      return [conv, ...prev]
    })
    selectConversation(conv.id)
  }, [selectConversation])

  const handleSelect = useCallback((id: string) => {
    selectConversation(id)
    // Reset unread count locally
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, unread_count: 0 } : c)),
    )
  }, [selectConversation])

  const handleConversationUpdate = useCallback(
    (id: string, patch: Partial<Pick<import("@/lib/types").Conversation, "name" | "avatar_url">>) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      )
    },
    [],
  )

  const handleConversationDeleted = useCallback((id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id))
    setSelectedId((prev) => {
      if (prev === id) {
        router.replace("/dashboard/messages", { scroll: false })
        return null
      }
      return prev
    })
  }, [router])

  const showConversationList = isBelowDesktop ? !selectedConversation : true
  const showConversationView = isBelowDesktop ? !!selectedConversation : !loading && !!selectedConversation

  return (
    <div className="flex flex-1 min-h-0 -mx-4 lg:-mx-8 -mt-6 lg:-mt-8 -mb-24 lg:-mb-12 overflow-hidden">
      {showConversationList ? (
        <ConversationSidebar
          conversations={conversations}
          selectedId={selectedId}
          currentUserId={currentUserId}
          onSelect={handleSelect}
          onConversationCreated={handleConversationCreated}
          profiles={profiles}
          compact={isBelowDesktop}
        />
      ) : null}

      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <MessageSquareDashed className="h-12 w-12 opacity-20 animate-pulse" />
          <div className="text-center">
            <p className="text-sm font-medium">Loading conversations</p>
            <p className="text-[12px] mt-0.5">Please wait a moment…</p>
          </div>
        </div>
      ) : showConversationView && selectedConversation ? (
        <ConversationView
          key={selectedConversation.id}
          conversation={selectedConversation}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          profiles={profiles}
          onBack={isBelowDesktop ? () => selectConversation(null) : undefined}
          onConversationUpdate={(patch) => handleConversationUpdate(selectedConversation.id, patch)}
          onLastMessage={handleLastMessage}
          onConversationDeleted={handleConversationDeleted}
        />
      ) : !isBelowDesktop ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <MessageSquareDashed className="h-12 w-12 opacity-20" />
          <div className="text-center">
            <p className="text-sm font-medium">No conversation selected</p>
            <p className="text-[12px] mt-0.5">Pick one from the sidebar or start a new DM</p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
