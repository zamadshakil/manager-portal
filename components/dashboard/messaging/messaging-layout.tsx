"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { MessageSquareDashed } from "lucide-react"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { ConversationSidebar } from "./conversation-sidebar"
import { ConversationView } from "./conversation-view"
import type { Conversation, Profile } from "@/lib/types"

interface MessagingLayoutProps {
  currentUserId: string
  currentUserName: string
  profiles: Profile[]
}

export function MessagingLayout({
  currentUserId,
  currentUserName,
  profiles,
}: MessagingLayoutProps) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const presenceRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Fetch conversation list
  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/messaging/conversations")
      if (!res.ok) throw new Error("Failed to load conversations")
      const data: Conversation[] = await res.json()
      setConversations(data)
    } catch {
      toast.error("Could not load conversations")
    }
  }, [])

  useEffect(() => {
    fetchConversations().finally(() => setLoading(false))
  }, [fetchConversations])

  // Background poll — refresh sidebar (last_message + unread_count) every 2 s.
  // Only the non-selected conversations are fully replaced; the selected one
  // keeps unread_count = 0 since it is currently being viewed.
  // This runs as a fallback when Realtime is unavailable.
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const res = await fetch("/api/messaging/conversations")
        if (!res.ok) return
        const fresh: Conversation[] = await res.json()
        setConversations((prev) => {
          return fresh.map((fc) => {
            if (fc.id === selectedId) {
              // Preserve the selected conv's member data but keep unread = 0
              const existing = prev.find((c) => c.id === fc.id)
              return { ...fc, members: existing?.members ?? fc.members, unread_count: 0 }
            }
            return fc
          })
        })
      } catch {
        // silent — stale data is acceptable
      }
    }, 2_000)
    return () => clearInterval(timer)
  }, [selectedId])

  // Supabase Realtime: sidebar channel for new conversations and message updates
  useEffect(() => {
    const supabase = createClient()
    let active = true
    let realtimeActive = false

    const channel = supabase
      .channel(`sidebar:${currentUserId}`)
      .on(
        "postgres_changes" as any,
        { event: "INSERT", schema: "public", table: "conversation_members" },
        async (payload: any) => {
          if (!active || payload.new.user_id !== currentUserId) return
          // New conversation added — refresh full list
          try {
            const res = await fetch("/api/messaging/conversations")
            if (res.ok) {
              const fresh: Conversation[] = await res.json()
              setConversations(fresh)
            }
          } catch {}
        },
      )
      .on(
        "postgres_changes" as any,
        { event: "INSERT", schema: "public", table: "messages" },
        async (payload: any) => {
          if (!active) return
          const convId = payload.new.conversation_id
          // Refresh the specific conversation to get updated last_message and unread_count
          try {
            const res = await fetch("/api/messaging/conversations")
            if (res.ok) {
              const fresh: Conversation[] = await res.json()
              setConversations((prev) => {
                const updated = fresh.find((c) => c.id === convId)
                if (!updated) return prev
                return prev.map((c) => {
                  if (c.id === convId) {
                    return {
                      ...updated,
                      unread_count: c.id === selectedId ? 0 : updated.unread_count,
                    }
                  }
                  return c
                })
              })
            }
          } catch {}
        },
      )
      .subscribe((status: string) => {
        if (!active) return
        if (status === "SUBSCRIBED") {
          realtimeActive = true
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          realtimeActive = false
        }
      })

    return () => {
      active = false
      realtimeActive = false
      supabase.removeChannel(channel)
    }
  }, [currentUserId, selectedId])

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
    setSelectedId(conv.id)
  }, [])

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id)
    // Reset unread count locally
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, unread_count: 0 } : c)),
    )
  }, [])

  return (
    <div className="flex h-[calc(100vh-4rem)] -mx-4 lg:-mx-8 -my-6 lg:-my-8 overflow-hidden">
      <ConversationSidebar
        conversations={conversations}
        selectedId={selectedId}
        currentUserId={currentUserId}
        onSelect={handleSelect}
        onConversationCreated={handleConversationCreated}
        profiles={profiles}
      />

      {selectedConversation ? (
        <ConversationView
          key={selectedConversation.id}
          conversation={selectedConversation}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
        />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <MessageSquareDashed className="h-12 w-12 opacity-20" />
          <div className="text-center">
            <p className="text-sm font-medium">No conversation selected</p>
            <p className="text-[12px] mt-0.5">Pick one from the sidebar or start a new DM</p>
          </div>
        </div>
      )}
    </div>
  )
}
