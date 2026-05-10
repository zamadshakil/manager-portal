"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { format, isToday, isYesterday } from "date-fns"
import { Clock, AlertCircle, Pencil, Trash2, SmilePlus, CornerUpRight, FileText, CheckCheck, X, Download } from "lucide-react"
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

type MessageSenderWithDeletedAt = NonNullable<Message["sender"]> & {
  deleted_at?: string | null
}

interface MessageRowProps {
  message: Message
  isOwn: boolean
  currentUserId: string
  isFirstInGroup: boolean
  isLastInGroup: boolean
  onReact: (msgId: string, emoji: string) => void
  onEdit: (msg: Message, newContent: string) => void
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
  currentUserId,
  isFirstInGroup,
  isLastInGroup,
  onReact,
  onEdit,
  onDelete,
  onReply,
  onRetry,
}: MessageRowProps) {
  const [hovered, setHovered] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const editRef = useRef<HTMLTextAreaElement>(null)
  const showActions = hovered || emojiOpen

  if (message.deleted_at) {
    return (
      <div className={cn("px-4 flex", isOwn ? "justify-end" : "justify-start", isLastInGroup ? "pb-1.5" : "pb-0.5")}>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/60 italic bg-muted/40 rounded-full px-3 py-1 border border-border/50">
          This message was deleted
        </span>
      </div>
    )
  }

  const sender = message.sender as MessageSenderWithDeletedAt | undefined
  const isDeletedUser = !!sender?.deleted_at
  const senderName = isDeletedUser
    ? (message.sender?.full_name ?? message.sender?.email ?? "Deleted User")
    : (message.sender?.full_name ?? message.sender?.email ?? "Unknown")
  const initials = senderName.slice(0, 2).toUpperCase()

  // Group reactions by emoji
  const reactionMap = new Map<string, { count: number; mine: boolean }>()
  for (const r of message.reactions ?? []) {
    const existing = reactionMap.get(r.emoji) ?? { count: 0, mine: false }
    reactionMap.set(r.emoji, { count: existing.count + 1, mine: existing.mine || r.user_id === currentUserId })
  }

  // Bubble border-radius: shave the inner corner for grouped messages to create a stacked look
  const ownRadiusClass = cn(
    "rounded-2xl",
    !isFirstInGroup && "rounded-tr-md",
    !isLastInGroup && "rounded-br-md",
  )
  const otherRadiusClass = cn(
    "rounded-2xl",
    !isFirstInGroup && "rounded-tl-md",
    !isLastInGroup && "rounded-bl-md",
  )

  return (
    <div
      className={cn(
        "group flex items-end gap-2 px-4",
        isFirstInGroup ? "pt-1.5" : "pt-0.5",
        isLastInGroup ? "pb-1" : "pb-0",
        isOwn ? "flex-row-reverse" : "flex-row",
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { if (!emojiOpen) setHovered(false) }}
    >
      {/* Avatar — only rendered on last in group; spacer div otherwise to maintain alignment */}
      <div className="shrink-0 w-7 mb-0.5" aria-hidden={!isLastInGroup}>
        {isLastInGroup ? (
          <Avatar className="h-7 w-7">
            <AvatarImage src={message.sender?.avatar_url ?? undefined} alt={senderName} />
            <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
          </Avatar>
        ) : (
          <div className="h-7 w-7" />
        )}
      </div>

      {/* Bubble column */}
      <div className={cn("relative flex flex-col min-w-0 max-w-[65%]", isOwn ? "items-end" : "items-start")}>

        {/* Floating action toolbar — appears above the bubble on hover */}
        <div
          role="toolbar"
          aria-label="Message actions"
          className={cn(
            "absolute -top-8 z-20 flex items-center gap-0.5 rounded-xl border border-border bg-background shadow-md px-1 py-0.5 transition-all duration-150",
            isOwn ? "right-0" : "left-0",
            showActions ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
          )}
        >
          <DropdownMenu
            open={emojiOpen}
            onOpenChange={(open) => {
              setEmojiOpen(open)
              if (!open) setHovered(false)
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Add reaction">
                <SmilePlus className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={isOwn ? "end" : "start"} className="p-1.5">
              <div className="flex gap-1">
                {QUICK_EMOJIS.map((e) => (
                  <button
                    key={e}
                    onClick={() => { onReact(message.id, e); setEmojiOpen(false) }}
                    className="text-lg hover:scale-125 transition-transform p-0.5 rounded"
                    aria-label={`React with ${e}`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => onReply(message)}
            aria-label="Reply to message"
          >
            <CornerUpRight className="h-3.5 w-3.5" />
          </Button>

          {isOwn && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="More message options">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {message.type === "text" && (
                  <DropdownMenuItem onClick={() => setEditing(true)}>
                    <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                  </DropdownMenuItem>
                )}
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

        {/* Sender name — only on first message in a group, incoming only */}
        {!isOwn && isFirstInGroup && (
          <span
            className={cn(
              "text-[11px] font-semibold px-1 mb-0.5 truncate max-w-full",
              isDeletedUser ? "text-muted-foreground/60 italic" : "text-primary",
            )}
          >
            {isDeletedUser ? `${senderName} (removed)` : senderName}
          </span>
        )}

        {/* Speech bubble */}
        <div
          className={cn(
            "relative px-3 py-2 text-sm shadow-sm wrap-break-word",
            isOwn
              ? cn("bg-primary text-primary-foreground", ownRadiusClass)
              : cn("bg-muted text-foreground", otherRadiusClass),
          )}
        >
          {/* Reply-to preview inside bubble */}
          {message.reply_to_id && (
            <div
              className={cn(
                "border-l-2 pl-2 pr-1 mb-2 py-1 rounded-md text-[11px] leading-snug",
                isOwn
                  ? "border-primary-foreground/50 bg-primary-foreground/10 text-primary-foreground/80"
                  : "border-primary/60 bg-background/40 text-muted-foreground",
              )}
            >
              <p className="font-semibold truncate">
                {message.reply_to?.sender?.full_name ?? message.reply_to?.sender?.email ?? "Unknown"}
              </p>
              <p className="truncate opacity-80">
                {message.reply_to?.content
                  ?? (message.reply_to?.type === "image" ? "📷 Photo"
                    : message.reply_to?.type === "video" ? "🎥 Video"
                    : message.reply_to?.type === "audio" ? "🎵 Audio"
                    : message.reply_to?.type === "file"  ? "📄 File"
                    : "…")}
              </p>
            </div>
          )}

          {/* Inline edit or message content */}
          {editing ? (
            <InlineEditArea
              initialText={message.content ?? ""}
              editRef={editRef}
              onSave={(text) => { onEdit(message, text); setEditing(false) }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <MessageContent message={message} isOwn={isOwn} />
          )}

          {/* Timestamp + delivery status row (inside bubble) */}
          <div className="flex items-center justify-end gap-1 mt-1">
            <span
              className={cn(
                "text-[10px] select-none tabular-nums",
                isOwn ? "text-primary-foreground/60" : "text-muted-foreground/70",
              )}
            >
              {formatTs(message.created_at)}
              {message.edited_at ? " · edited" : ""}
            </span>
            {isOwn && message.status === "sending" && (
              <Clock className="h-3 w-3 text-primary-foreground/60 shrink-0" aria-label="Sending" />
            )}
            {isOwn && message.status !== "sending" && message.status !== "failed" && (
              <CheckCheck className="h-3 w-3 text-primary-foreground/60 shrink-0" aria-label="Sent" />
            )}
          </div>
        </div>

        {/* Failed retry — below bubble */}
        {message.status === "failed" && (
          <button
            onClick={() => onRetry?.(message)}
            className="flex items-center gap-1.5 text-[11px] text-destructive bg-destructive/10 hover:bg-destructive/15 rounded-full px-3 py-1 mt-1 transition-colors border border-destructive/20"
            aria-label="Message failed to send — click to retry"
          >
            <AlertCircle className="h-3 w-3 shrink-0" />
            Failed to send · <span className="underline font-medium">Retry</span>
          </button>
        )}

        {/* Reactions — below bubble */}
        {reactionMap.size > 0 && (
          <div
            className={cn("flex flex-wrap gap-1 mt-1", isOwn ? "justify-end" : "justify-start")}
            role="group"
            aria-label="Reactions"
          >
            {Array.from(reactionMap.entries()).map(([emoji, { count, mine }]) => (
              <button
                key={emoji}
                onClick={() => onReact(message.id, emoji)}
                aria-label={`${emoji} ${count} reaction${count !== 1 ? "s" : ""}${mine ? ", including yours" : ""}`}
                aria-pressed={mine}
                className={cn(
                  "flex items-center gap-0.5 rounded-full h-6 px-2 text-xs border transition-all",
                  mine
                    ? "bg-primary/10 border-primary/40 text-primary ring-1 ring-primary/20 font-medium"
                    : "bg-background border-border hover:bg-accent text-foreground/80",
                )}
              >
                <span aria-hidden="true">{emoji}</span>
                <span className="text-[11px] ml-0.5 tabular-nums">{count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const URL_SPLIT_REGEX = /(https?:\/\/[^\s]+)/g
const URL_TEST_REGEX = /^https?:\/\//

function TextWithLinks({ text, isOwn }: { text: string; isOwn: boolean }) {
  const parts = text.split(URL_SPLIT_REGEX)
  return (
    <p className="text-sm leading-relaxed whitespace-pre-wrap wrap-break-word">
      {parts.map((part, i) =>
        URL_TEST_REGEX.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "underline underline-offset-2 break-all",
              isOwn ? "text-primary-foreground/90 hover:text-primary-foreground" : "text-primary hover:text-primary/80",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </p>
  )
}

function MessageContent({ message, isOwn }: { message: Message; isOwn: boolean }) {
  const [lightboxOpen, setLightboxOpen] = useState(false)

  if (message.type === "text") {
    return <TextWithLinks text={message.content ?? ""} isOwn={isOwn} />
  }

  if (message.type === "image") {
    return (
      <>
        <div
          className="mt-1 max-w-65 cursor-zoom-in"
          onClick={() => setLightboxOpen(true)}
          role="button"
          aria-label="View full image"
        >
          <img
            src={message.media_url ?? ""}
            alt="image"
            loading="lazy"
            className="rounded-lg object-cover max-h-64 w-auto hover:opacity-90 transition-opacity"
          />
        </div>

        {lightboxOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={() => setLightboxOpen(false)}
          >
            <div
              className="relative max-w-[90vw] max-h-[90vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={message.media_url ?? ""}
                alt="Full size image"
                className="max-w-[90vw] max-h-[90vh] rounded-lg object-contain shadow-2xl"
              />
              {/* Close */}
              <button
                className="absolute top-2 right-2 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80 transition-colors"
                onClick={() => setLightboxOpen(false)}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
              {/* Download */}
              <a
                href={message.media_url ?? ""}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="absolute bottom-2 right-2 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80 transition-colors"
                onClick={(e) => e.stopPropagation()}
                aria-label="Download image"
              >
                <Download className="h-4 w-4" />
              </a>
            </div>
          </div>
        )}
      </>
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
      <div className="mt-1 max-w-65">
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
      <span className="truncate max-w-50">
        {meta?.name ?? "File"}
        {meta?.size ? ` (${(meta.size / 1024).toFixed(0)} KB)` : ""}
      </span>
    </a>
  )
}

interface InlineEditAreaProps {
  initialText: string
  editRef: React.RefObject<HTMLTextAreaElement | null>
  onSave: (text: string) => void
  onCancel: () => void
}

function InlineEditArea({ initialText, editRef, onSave, onCancel }: InlineEditAreaProps) {
  const [value, setValue] = useState(initialText)

  useEffect(() => {
    editRef.current?.focus()
    const len = editRef.current?.value.length ?? 0
    editRef.current?.setSelectionRange(len, len)
  }, [editRef])

  const handleKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      const trimmed = value.trim()
      if (trimmed) onSave(trimmed)
    }
    if (e.key === "Escape") onCancel()
  }, [value, onSave, onCancel])

  return (
    <div className="flex flex-col gap-1 w-full">
      <textarea
        ref={editRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKey}
        rows={2}
        className="w-full resize-none bg-transparent text-sm outline-none border-b border-primary-foreground/30 focus:border-primary-foreground leading-relaxed"
        style={{ minHeight: "2rem" }}
      />
      <div className="flex gap-2 text-[10px] opacity-70">
        <span>Enter to save</span>
        <span>Esc to cancel</span>
      </div>
    </div>
  )
}
