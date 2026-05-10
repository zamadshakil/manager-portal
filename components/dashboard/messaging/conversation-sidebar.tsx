"use client"

import { useState, useRef, useCallback } from "react"
import { Search, Plus, Users, MessageSquare, Edit2 } from "lucide-react"
import { format, isToday, isYesterday } from "date-fns"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NewConversationModal } from "./new-conversation-modal"
import type { Conversation, Profile } from "@/lib/types"

interface ConversationSidebarProps {
  conversations: Conversation[]
  selectedId: string | null
  currentUserId: string
  onSelect: (id: string) => void
  onConversationCreated: (conv: Conversation) => void
  profiles: Profile[]
  compact?: boolean
}

type MemberProfileWithDeletedAt = {
  deleted_at?: string | null
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
  if (isYesterday(d)) return "Yesterday"
  return format(d, "d MMM")
}

export function ConversationSidebar({
  conversations,
  selectedId,
  currentUserId,
  onSelect,
  onConversationCreated,
  profiles,
  compact = false,
}: ConversationSidebarProps) {
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<"all" | "unread" | "groups">("all")
  const [modalOpen, setModalOpen] = useState(false)
  const [modalType, setModalType] = useState<"dm" | "group">("dm")
  const listRef = useRef<HTMLDivElement>(null)

  const unreadCount = conversations.filter((c) => (c.unread_count ?? 0) > 0).length
  const groupCount = conversations.filter((c) => c.type === "group").length

  const filtered = conversations.filter((c) => {
    const name = convDisplayName(c, currentUserId).toLowerCase()
    if (!name.includes(search.toLowerCase())) return false
    if (filter === "unread") return (c.unread_count ?? 0) > 0
    if (filter === "groups") return c.type === "group"
    return true
  })

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = listRef.current?.querySelectorAll<HTMLButtonElement>("[role='option']")
    if (!items || items.length === 0) return
    const active = document.activeElement as HTMLButtonElement
    const idx = Array.from(items).indexOf(active)
    if (e.key === "ArrowDown") {
      e.preventDefault()
      items[Math.min(idx + 1, items.length - 1)]?.focus()
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      items[Math.max(idx - 1, 0)]?.focus()
    }
  }, [])

  const FILTER_CONFIG = [
    { key: "all" as const, label: "All", count: null },
    { key: "unread" as const, label: "Unread", count: unreadCount },
    { key: "groups" as const, label: "Groups", count: groupCount },
  ]

  const listPanelId = "conv-list-panel"

  return (
    <aside
      className={cn(
        "flex flex-col h-full bg-sidebar",
        compact ? "w-full min-w-0" : "w-72 shrink-0 border-r border-border",
      )}
      aria-label="Conversations"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-border shrink-0">
        <span className="text-[15px] font-semibold tracking-tight">Messages</span>
        <div className="flex gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
            title="New direct message"
            aria-label="New direct message"
            onClick={() => { setModalType("dm"); setModalOpen(true) }}
          >
            <Edit2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
            title="New group"
            aria-label="New group"
            onClick={() => { setModalType("group"); setModalOpen(true) }}
          >
            <Users className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 pt-3 pb-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations…"
            className="pl-8 h-8 text-sm bg-muted/50 border-transparent focus-visible:border-border focus-visible:bg-background rounded-lg"
            aria-label="Search conversations"
          />
        </div>
      </div>

      {/* Filter tabs */}
      <div
        className="flex gap-1 px-3 pb-2.5 shrink-0"
        role="tablist"
        aria-label="Filter conversations"
      >
        {FILTER_CONFIG.map(({ key, label, count }) => (
          <button
            key={key}
            role="tab"
            id={`conv-tab-${key}`}
            aria-selected={filter === key}
            aria-controls={listPanelId}
            onClick={() => setFilter(key)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              filter === key
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-accent",
            )}
          >
            {label}
            {count !== null && count > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums",
                  filter === key
                    ? "bg-white/20 text-primary-foreground"
                    : "bg-primary text-primary-foreground",
                )}
                aria-label={`${count} ${label.toLowerCase()}`}
              >
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Conversation list */}
      <div
        ref={listRef}
        id={listPanelId}
        role="listbox"
        aria-label="Conversation list"
        aria-live="polite"
        onKeyDown={handleKeyDown}
        className={cn("flex-1 overflow-y-auto", compact && "pb-[calc(4rem+env(safe-area-inset-bottom))]")}
      >
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6 py-8">
            <div className="rounded-full bg-muted p-3">
              <MessageSquare className="h-5 w-5 text-muted-foreground/60" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground/70">
                {search ? "No results" : filter !== "all" ? `No ${filter} conversations` : "No conversations yet"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {search ? "Try a different search term" : "Start a DM or create a group"}
              </p>
            </div>
            {!search && filter === "all" && (
              <Button
                size="sm"
                variant="outline"
                className="mt-1 text-xs h-7"
                onClick={() => { setModalType("dm"); setModalOpen(true) }}
              >
                <Plus className="h-3 w-3 mr-1" /> New Message
              </Button>
            )}
          </div>
        ) : (
          <div className="py-1">
            {filtered.map((conv) => {
              const isGroup = conv.type === "group"
              const otherMember = conv.members?.find((m) => m.user_id !== currentUserId)
              const otherProfile = otherMember?.profile as ({
                id: string
                full_name: string | null
                email: string
                avatar_url: string | null
              } & MemberProfileWithDeletedAt) | undefined
              const otherMemberDeleted = !isGroup && !!otherProfile?.deleted_at
              const name = isGroup
                ? (conv.name ?? "Group")
                : (otherMember?.profile?.full_name ?? otherMember?.profile?.email ?? "DM")
              const initials = name.slice(0, 2).toUpperCase()
              const isSelected = conv.id === selectedId
              const unread = conv.unread_count ?? 0
              const lastMsg = conv.last_message
              const avatarSrc = convAvatar(conv, currentUserId)

              const lastMsgPreview = lastMsg
                ? lastMsg.type !== "text"
                  ? `📎 ${lastMsg.type}`
                  : lastMsg.content ?? ""
                : ""

              return (
                <button
                  key={conv.id}
                  role="option"
                  aria-selected={isSelected}
                  aria-label={`${name}${unread > 0 ? `, ${unread} unread` : ""}${lastMsgPreview ? `, last message: ${lastMsgPreview}` : ""}`}
                  onClick={() => onSelect(conv.id)}
                  className={cn(
                    "group w-[calc(100%-8px)] flex items-center gap-3 px-3 py-2.5 mx-1 min-h-12 rounded-xl transition-all text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                    isSelected
                      ? "bg-primary/10 text-foreground"
                      : "hover:bg-accent/70 text-foreground",
                  )}
                >
                  {/* Avatar with group indicator */}
                  <div className="relative shrink-0">
                    <Avatar className={cn("h-10 w-10 transition-transform", !isSelected && "group-hover:scale-[1.03]")}>
                      <AvatarImage src={avatarSrc} alt={name} />
                      <AvatarFallback
                        className={cn(
                          "text-[12px] font-semibold",
                          isSelected ? "bg-primary/20 text-primary" : "bg-muted",
                        )}
                      >
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    {isGroup && (
                      <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-sidebar border-2 border-sidebar p-0.5">
                        <Users className="h-2.5 w-2.5 text-muted-foreground" />
                      </span>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-1.5 mb-0.5">
                      <p className={cn("text-sm truncate leading-snug", unread > 0 ? "font-semibold" : "font-medium")}>
                        {name}
                      </p>
                      <span className={cn("text-[10px] shrink-0 tabular-nums", unread > 0 ? "text-primary font-medium" : "text-muted-foreground")}>
                        {lastMsg ? formatConvTs(lastMsg.created_at) : ""}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-1.5">
                      <p className={cn("text-xs truncate leading-snug", unread > 0 ? "text-foreground/80 font-medium" : "text-muted-foreground")}>
                        {otherMemberDeleted ? (
                          <span className="italic">User removed</span>
                        ) : lastMsgPreview || (
                          <span className="italic">No messages yet</span>
                        )}
                      </p>
                      {unread > 0 && (
                        <span className="shrink-0 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-none min-w-4.5 h-4.5 px-1 tabular-nums">
                          {unread > 99 ? "99+" : unread}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer new conversation shortcut */}
      <div className="shrink-0 border-t border-border px-3 py-2.5">
        <button
          onClick={() => { setModalType("dm"); setModalOpen(true) }}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent/70 transition-colors text-sm"
          aria-label="Start new conversation"
        >
          <span className="flex items-center justify-center h-7 w-7 rounded-lg bg-muted shrink-0">
            <Plus className="h-3.5 w-3.5" />
          </span>
          <span className="font-medium">New conversation</span>
        </button>
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
