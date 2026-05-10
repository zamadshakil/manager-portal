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
      const res = await fetch("/api/messaging/conversations")
      if (!res.ok) throw new Error("Failed to load conversations")
      const data: Conversation[] = await res.json()
      setConversations((prev) =>
        (data as Conversation[]).map((fc) => {
          if (fc.id === selectedIdRef.current) {
            const existing = prev.find((c) => c.id === fc.id)
            return { ...fc, members: existing?.members ?? fc.members, unread_count: 0 }
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
  const handleLastMessage = useCallback((convId: string, message: import("@/lib/types").Message) => {
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === convId)
      if (idx === -1) return prev
      const updated = { ...prev[idx], last_message: message }
      // Re-sort: move this conversation to the top (most-recent first)
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
  const urlValidatedRef = useRef(false)
  useEffect(() => {
    if (loading || urlValidatedRef.current) return
    urlValidatedRef.current = true
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

  // Supabase Realtime: sidebar channel for new conversations and message updates.
  // Both handlers call scheduleRefresh() (debounced 400 ms) instead of fetching
  // directly — this coalesces bursts and avoids duplicate in-flight requests.
  // The effect no longer depends on selectedId, so the channel is not recreated
  // every time the user clicks a different conversation.
  useEffect(() => {
    const supabase = createClient()
    let active = true

    const channel = supabase
      .channel(`sidebar:${currentUserId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversation_members" },
        (payload: ConversationMemberInsertPayload) => {
          if (!active || payload.new.user_id !== currentUserId) return
          scheduleRefresh()
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        () => {
          if (!active) return
          scheduleRefresh()
        },
      )
      .subscribe()

    return () => {
      active = false
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current)
      supabase.removeChannel(channel)
    }
  }, [currentUserId, scheduleRefresh])

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

  const handleConversationHidden = useCallback((id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id))
    setSelectedId((prev) => {
      if (prev === id) {
        // Clear the URL param when the active conversation is hidden
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
          onConversationHidden={handleConversationHidden}
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
