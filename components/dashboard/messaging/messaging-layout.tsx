"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { MessageSquareDashed } from "lucide-react"
import { toast } from "sonner"
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
