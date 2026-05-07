"use client"

import { useState } from "react"
import { format, isToday, isYesterday } from "date-fns"
import { Clock, AlertCircle, Pencil, Trash2, SmilePlus, CornerUpRight, FileText } from "lucide-react"
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

  if (message.deleted_at) {
    return (
      <div className="px-4 py-1.5 text-sm text-muted-foreground italic">
        This message was deleted
      </div>
    )
  }

  const senderName = message.sender?.full_name ?? message.sender?.email ?? "Unknown"
  const initials = senderName.slice(0, 2).toUpperCase()

  // Group reactions by emoji
  const reactionMap = new Map<string, { count: number; mine: boolean }>()
  for (const r of message.reactions ?? []) {
    const existing = reactionMap.get(r.emoji) ?? { count: 0, mine: false }
    reactionMap.set(r.emoji, {
      count: existing.count + 1,
      mine: existing.mine,
    })
  }

  return (
    <div
      className={cn("group flex gap-3 px-4 py-1.5 hover:bg-accent/30 rounded-lg")}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setEmojiOpen(false) }}
    >
      {/* Avatar */}
      <div className="shrink-0 mt-0.5">
        <Avatar className="h-8 w-8">
          <AvatarImage src={message.sender?.avatar_url ?? undefined} />
          <AvatarFallback className="text-[11px]">{initials}</AvatarFallback>
        </Avatar>
      </div>

      <div className="flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold leading-snug truncate">{senderName}</span>
          <span className="text-[11px] text-muted-foreground shrink-0">{formatTs(message.created_at)}</span>
          {message.edited_at && (
            <span className="text-[10px] text-muted-foreground">(edited)</span>
          )}
          {message.status === "sending" && (
            <Clock className="h-3 w-3 text-muted-foreground" />
          )}
          {message.status === "failed" && (
            <button
              onClick={() => onRetry?.(message)}
              className="flex items-center gap-1 text-[11px] text-destructive hover:underline"
            >
              <AlertCircle className="h-3 w-3" />
              Failed — retry
            </button>
          )}
        </div>

        {/* Reply preview */}
        {message.reply_to && (
          <div className="border-l-2 border-primary/40 pl-2 mb-1 text-[12px] text-muted-foreground truncate">
            {message.reply_to.sender?.full_name ?? "Someone"}: {message.reply_to.content ?? "…"}
          </div>
        )}

        {/* Content */}
        <MessageContent message={message} />

        {/* Reactions */}
        {reactionMap.size > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
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

      {/* Action bar — visible on hover */}
      {hovered && (
        <div className="flex items-center gap-0.5 shrink-0 -mt-0.5">
          {/* Quick emoji picker */}
          <DropdownMenu open={emojiOpen} onOpenChange={setEmojiOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <SmilePlus className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="p-1">
              <div className="flex gap-1">
                {QUICK_EMOJIS.map((e) => (
                  <button
                    key={e}
                    onClick={() => { onReact(message.id, e); setEmojiOpen(false) }}
                    className="text-lg hover:scale-125 transition-transform"
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
      )}
    </div>
  )
}

function MessageContent({ message }: { message: Message }) {
  if (message.type === "text") {
    return <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{message.content}</p>
  }

  if (message.type === "image") {
    return (
      <div className="mt-1 max-w-sm">
        <img
          src={message.media_url ?? ""}
          alt="image"
          loading="lazy"
          className="rounded-lg object-cover max-h-64 w-auto border border-border"
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
      <div className="mt-1 max-w-sm">
        <video
          controls
          src={message.media_url ?? ""}
          className="rounded-lg border border-border max-h-64 w-auto"
        />
      </div>
    )
  }

  // file
  const meta = message.media_metadata as { name?: string; size?: number } | null
  return (
    <a
      href={message.media_url ?? "#"}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent transition-colors w-fit"
    >
      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="truncate max-w-[240px]">
        {meta?.name ?? "File"}
        {meta?.size ? ` (${(meta.size / 1024).toFixed(0)} KB)` : ""}
      </span>
    </a>
  )
}
