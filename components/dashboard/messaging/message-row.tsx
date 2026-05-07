"use client"

import { useState } from "react"
import { format, isToday, isYesterday } from "date-fns"
import { Clock, AlertCircle, Pencil, Trash2, SmilePlus, CornerUpRight, FileText, CheckCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { Message } from "@/lib/types"

interface MessageRowProps {
  message: Message
  isOwn: boolean
  onReact: (msgId: string, emoji: string) => void
  onEdit: (msg: Message) => void
  onDelete: (msgId: string) => void
  onReply: (msg: Message) => void
  onRetry?: (msg: Message) => void
}

function formatTs(iso: string) {
  const d = new Date(iso)
  if (isToday(d)) return format(d, "HH:mm")
  if (isYesterday(d)) return `Yesterday ${format(d, "HH:mm")}`
  return format(d, "d MMM, HH:mm")
}

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥"]

export function MessageRow({
  message,
  isOwn,
  onReact,
  onEdit,
  onDelete,
  onReply,
  onRetry,
}: MessageRowProps) {
  const [hovered, setHovered] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  // Keep actions visible while any dropdown is open to prevent flickering
  const showActions = hovered || emojiOpen

  if (message.deleted_at) {
    return (
      <div className={cn("px-4 py-1.5 flex", isOwn ? "justify-end" : "justify-start")}>
        <span className="text-xs text-muted-foreground italic">This message was deleted</span>
      </div>
    )
  }

  const senderName = message.sender?.full_name ?? message.sender?.email ?? "Unknown"
  const initials = senderName.slice(0, 2).toUpperCase()

  // Group reactions by emoji
  const reactionMap = new Map<string, { count: number; mine: boolean }>()
  for (const r of message.reactions ?? []) {
    const existing = reactionMap.get(r.emoji) ?? { count: 0, mine: false }
    reactionMap.set(r.emoji, { count: existing.count + 1, mine: existing.mine })
  }

  return (
    // DOM order: [Avatar] [BubbleColumn] [ActionBar]
    // flex-row        → Avatar LEFT, Bubble MIDDLE, Actions RIGHT  (other messages)
    // flex-row-reverse → Avatar RIGHT, Bubble MIDDLE, Actions LEFT  (own messages)
    <div
      className={cn("flex items-end gap-2 px-4 py-1", isOwn ? "flex-row-reverse" : "flex-row")}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { if (!emojiOpen) setHovered(false) }}
    >
      {/* Avatar — extreme right for own, extreme left for others */}
      <div className="shrink-0 mb-0.5">
        <Avatar className="h-7 w-7">
          <AvatarImage src={message.sender?.avatar_url ?? undefined} />
          <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
        </Avatar>
      </div>

      {/* Bubble column */}
      <div className={cn("flex flex-col min-w-0 max-w-[65%]", isOwn ? "items-end" : "items-start")}>
        {/* Sender name — only for incoming messages */}
        {!isOwn && (
          <span className="text-[11px] font-semibold text-primary px-1 mb-0.5 truncate max-w-full">
            {senderName}
          </span>
        )}

        {/* Speech bubble */}
        <div
          className={cn(
            "relative rounded-2xl px-3 py-2 text-sm shadow-sm break-words",
            isOwn
              ? "bg-primary text-primary-foreground rounded-tr-sm"
              : "bg-muted text-foreground rounded-tl-sm",
          )}
        >
          {/* Reply-to preview inside bubble */}
          {message.reply_to && (
            <div
              className={cn(
                "border-l-2 pl-2 pr-1 mb-2 py-1 rounded text-[11px] leading-snug",
                isOwn
                  ? "border-primary-foreground/50 bg-primary-foreground/10 text-primary-foreground/80"
                  : "border-primary/50 bg-background/30 text-muted-foreground",
              )}
            >
              <p className="font-semibold truncate">
                {message.reply_to.sender?.full_name ?? "Someone"}
              </p>
              <p className="truncate">{message.reply_to.content ?? "Media"}</p>
            </div>
          )}

          {/* Message content */}
          <MessageContent message={message} isOwn={isOwn} />

          {/* Timestamp + delivery status row (inside bubble) */}
          <div className="flex items-center justify-end gap-1 mt-1">
            <span
              className={cn(
                "text-[10px] select-none",
                isOwn ? "text-primary-foreground/70" : "text-muted-foreground",
              )}
            >
              {formatTs(message.created_at)}
              {message.edited_at ? " (edited)" : ""}
            </span>
            {isOwn && message.status === "sending" && (
              <Clock className="h-3 w-3 text-primary-foreground/70 shrink-0" />
            )}
            {isOwn && message.status !== "sending" && message.status !== "failed" && (
              <CheckCheck className="h-3 w-3 text-primary-foreground/70 shrink-0" />
            )}
          </div>
        </div>

        {/* Failed retry — below bubble */}
        {message.status === "failed" && (
          <button
            onClick={() => onRetry?.(message)}
            className="flex items-center gap-1 text-[11px] text-destructive hover:underline mt-0.5 px-1"
          >
            <AlertCircle className="h-3 w-3" /> Failed — retry
          </button>
        )}

        {/* Reactions — below bubble */}
        {reactionMap.size > 0 && (
          <div className={cn("flex flex-wrap gap-1 mt-1", isOwn ? "justify-end" : "justify-start")}>
            {Array.from(reactionMap.entries()).map(([emoji, { count, mine }]) => (
              <button
                key={emoji}
                onClick={() => onReact(message.id, emoji)}
                className={cn(
                  "flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs border transition-colors",
                  mine
                    ? "bg-primary/10 border-primary/30 text-primary"
                    : "bg-background border-border hover:bg-accent",
                )}
              >
                {emoji} <span className="text-[11px]">{count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Action bar — always mounted, opacity-toggled to prevent unmount-flicker */}
      <div
        className={cn(
          "flex items-center gap-0.5 shrink-0 self-end mb-0.5 transition-opacity duration-100",
          showActions ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      >
        {/* Quick emoji reactions */}
        <DropdownMenu
          open={emojiOpen}
          onOpenChange={(open) => {
            setEmojiOpen(open)
            if (!open) setHovered(false)
          }}
        >
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <SmilePlus className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={isOwn ? "start" : "end"} className="p-1">
            <div className="flex gap-1">
              {QUICK_EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => { onReact(message.id, e); setEmojiOpen(false) }}
                  className="text-lg hover:scale-125 transition-transform p-0.5"
                >
                  {e}
                </button>
              ))}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onReply(message)}>
          <CornerUpRight className="h-3.5 w-3.5" />
        </Button>

        {isOwn && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(message)}>
                <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onDelete(message.id)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}

function MessageContent({ message, isOwn }: { message: Message; isOwn: boolean }) {
  if (message.type === "text") {
    return <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{message.content}</p>
  }

  if (message.type === "image") {
    return (
      <div className="mt-1 max-w-[260px]">
        <img
          src={message.media_url ?? ""}
          alt="image"
          loading="lazy"
          className="rounded-lg object-cover max-h-64 w-auto"
        />
      </div>
    )
  }

  if (message.type === "audio") {
    return (
      <div className="mt-1">
        <audio controls src={message.media_url ?? ""} className="max-w-xs h-10" />
      </div>
    )
  }

  if (message.type === "video") {
    return (
      <div className="mt-1 max-w-[260px]">
        <video controls src={message.media_url ?? ""} className="rounded-lg max-h-64 w-auto" />
      </div>
    )
  }

  const meta = message.media_metadata as { name?: string; size?: number } | null
  return (
    <a
      href={message.media_url ?? "#"}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:opacity-80 transition-opacity w-fit",
        isOwn ? "bg-primary-foreground/10" : "bg-background/50 border border-border",
      )}
    >
      <FileText
        className={cn(
          "h-4 w-4 shrink-0",
          isOwn ? "text-primary-foreground/70" : "text-muted-foreground",
        )}
      />
      <span className="truncate max-w-[200px]">
        {meta?.name ?? "File"}
        {meta?.size ? ` (${(meta.size / 1024).toFixed(0)} KB)` : ""}
      </span>
    </a>
  )
}
