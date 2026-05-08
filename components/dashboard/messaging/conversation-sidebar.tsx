"use client"

import { useState, useEffect } from "react"
import { Search, Plus, Users, MessageSquare } from "lucide-react"
import { format, isToday } from "date-fns"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { NewConversationModal } from "./new-conversation-modal"
import type { Conversation, Profile } from "@/lib/types"

interface ConversationSidebarProps {
  conversations: Conversation[]
  selectedId: string | null
  currentUserId: string
  onSelect: (id: string) => void
  onConversationCreated: (conv: Conversation) => void
  profiles: Profile[]
}

function convDisplayName(conv: Conversation, currentUserId: string): string {
  if (conv.type === "group") return conv.name ?? "Group"
  const other = conv.members?.find((m) => m.user_id !== currentUserId)
  return other?.profile?.full_name ?? other?.profile?.email ?? "DM"
}

function convAvatar(conv: Conversation, currentUserId: string): string | undefined {
  if (conv.type === "group") return conv.avatar_url ?? undefined
  const other = conv.members?.find((m) => m.user_id !== currentUserId)
  return other?.profile?.avatar_url ?? undefined
}

function formatConvTs(iso: string) {
  const d = new Date(iso)
  if (isToday(d)) return format(d, "HH:mm")
  return format(d, "d MMM")
}

export function ConversationSidebar({
  conversations,
  selectedId,
  currentUserId,
  onSelect,
  onConversationCreated,
  profiles,
}: ConversationSidebarProps) {
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<"all" | "unread" | "groups">("all")
  const [modalOpen, setModalOpen] = useState(false)
  const [modalType, setModalType] = useState<"dm" | "group">("dm")

  const unreadCount = conversations.filter((c) => (c.unread_count ?? 0) > 0).length
  const groupCount = conversations.filter((c) => c.type === "group").length

  const filtered = conversations.filter((c) => {
    const name = convDisplayName(c, currentUserId).toLowerCase()
    if (!name.includes(search.toLowerCase())) return false
    if (filter === "unread") return (c.unread_count ?? 0) > 0
    if (filter === "groups") return c.type === "group"
    return true
  })

  return (
    <aside className="w-72 shrink-0 border-r border-border flex flex-col h-full bg-sidebar">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-[15px] font-semibold">Messages</span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="New DM"
            onClick={() => { setModalType("dm"); setModalOpen(true) }}
          >
            <MessageSquare className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="New Group"
            onClick={() => { setModalType("group"); setModalOpen(true) }}
          >
            <Users className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 pt-2 pb-1">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations…"
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex gap-1.5 px-3 pb-2 overflow-x-auto scrollbar-none border-b border-border">
        {(["all", "unread", "groups"] as const).map((f) => {
          const badge = f === "unread" ? unreadCount : f === "groups" ? groupCount : null
          const label =
            f === "all" ? "All" :
            f === "unread" ? `Unread${badge ? ` ${badge}` : ""}` :
            `Groups${badge ? ` ${badge}` : ""}`
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                filter === f
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground text-sm px-4 text-center">
            <Plus className="h-8 w-8 opacity-30" />
            <p>No conversations yet. Start a DM or create a group.</p>
          </div>
        )}
        {filtered.map((conv) => {
          const isGroup = conv.type === "group"
          const otherMember = conv.members?.find((m) => m.user_id !== currentUserId)
          const otherMemberDeleted = !isGroup && !!(otherMember?.profile as any)?.deleted_at
          const name = isGroup
            ? (conv.name ?? "Group")
            : (otherMember?.profile?.full_name ?? otherMember?.profile?.email ?? "DM")
          const initials = name.slice(0, 2).toUpperCase()
          const isSelected = conv.id === selectedId
          const unread = conv.unread_count ?? 0
          const lastMsg = conv.last_message

          return (
            <button
              key={conv.id}
              onClick={() => onSelect(conv.id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 hover:bg-accent/60 transition-colors text-left",
                isSelected && "bg-accent",
              )}
            >
              {/* Avatar */}
              <div className="relative shrink-0">
                <Avatar className="h-9 w-9">
                  <AvatarImage src={convAvatar(conv, currentUserId)} />
                  <AvatarFallback className="text-[11px]">{initials}</AvatarFallback>
                </Avatar>
                {conv.type === "group" && (
                  <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-muted border border-background p-0.5">
                    <Users className="h-2.5 w-2.5 text-muted-foreground" />
                  </span>
                )}
              </div>

              {/* Text */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-medium truncate">{name}</p>
                  {otherMemberDeleted && (
                    <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Removed</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {lastMsg
                    ? lastMsg.type !== "text"
                      ? `[${lastMsg.type}]`
                      : lastMsg.content ?? ""
                    : "No messages yet"}
                </p>
              </div>

              {/* Timestamp */}
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {lastMsg ? formatConvTs(lastMsg.created_at) : ""}
                </span>
                {unread > 0 && (
                  <Badge className="h-4 min-w-4 px-1 text-[10px] shrink-0">{unread}</Badge>
                )}
              </div>
            </button>
          )
        })}
      </div>

      <NewConversationModal
        open={modalOpen}
        type={modalType}
        profiles={profiles}
        currentUserId={currentUserId}
        onClose={() => setModalOpen(false)}
        onCreated={(conv) => {
          onConversationCreated(conv)
          setModalOpen(false)
        }}
      />
    </aside>
  )
}
