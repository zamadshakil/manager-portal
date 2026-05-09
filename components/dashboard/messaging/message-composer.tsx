"use client"

import { useRef, useState, useCallback, useEffect } from "react"
import { Send, Paperclip, Smile, X, Loader2, CornerUpRight } from "lucide-react"
import EmojiPicker, { EmojiStyle, type EmojiClickData } from "emoji-picker-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { Message } from "@/lib/types"

interface MessageComposerProps {
  conversationId: string
  replyTo: Message | null
  onClearReply: () => void
  onSend: (payload: {
    content?: string
    type: string
    media_url?: string
    media_metadata?: Record<string, unknown>
    reply_to_id?: string
  }) => void
  onTyping: () => void
}

interface PendingAttachment {
  id: string
  name: string
  size: number
  type: string
  status: "uploading" | "failed"
  previewUrl: string | null
  error: string | null
}

const ACCEPT = [
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "audio/mpeg", "audio/ogg", "audio/mp4", "audio/webm",
  "video/mp4", "video/webm",
].join(",")

export function MessageComposer({
  conversationId,
  replyTo,
  onClearReply,
  onSend,
  onTyping,
}: MessageComposerProps) {
  const [text, setText] = useState("")
  const [uploading, setUploading] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const previewUrlRef = useRef<string | null>(null)
  const replyPreviewId = replyTo ? "reply-preview" : undefined

  // Auto-resize textarea on every text change
  useEffect(() => {
    const el = textRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`
  }, [text])

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
      }
    }
  }, [])

  const handleSend = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed) return
    onSend({
      content: trimmed,
      type: "text",
      reply_to_id: replyTo?.id,
    })
    setText("")
    onClearReply()
    // Reset height after clearing
    if (textRef.current) textRef.current.style.height = "auto"
    setTimeout(() => textRef.current?.focus(), 0)
  }, [text, replyTo, onSend, onClearReply])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleEmojiClick = (data: EmojiClickData) => {
    setText((prev) => prev + data.emoji)
    setEmojiOpen(false)
    textRef.current?.focus()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ""
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
    const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null
    previewUrlRef.current = previewUrl
    const pendingId = crypto.randomUUID()
    setPendingAttachment({
      id: pendingId,
      name: file.name,
      size: file.size,
      type: file.type,
      status: "uploading",
      previewUrl,
      error: null,
    })
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append("conversationId", conversationId)
      formData.append("file", file)

      const res = await fetch("/api/messaging/upload", {
        method: "POST",
        body: formData,
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(payload?.error || "Upload failed")
      }

      const { url, type, media_metadata } = payload as {
        url: string
        type: string
        media_metadata: Record<string, unknown>
      }

      onSend({
        type,
        media_url: url,
        media_metadata,
        reply_to_id: replyTo?.id,
      })
      onClearReply()
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
        previewUrlRef.current = null
      }
      setPendingAttachment(null)
    } catch (err) {
      console.error("[upload]", err)
      const message = err instanceof Error ? err.message : "Upload failed"
      setPendingAttachment((prev) =>
        prev && prev.id === pendingId
          ? { ...prev, status: "failed", error: message }
          : prev,
      )
      toast.error(message)
    } finally {
      setUploading(false)
    }
  }

  const clearPendingAttachment = useCallback(() => {
    setPendingAttachment((prev) => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
        previewUrlRef.current = null
      }
      return null
    })
  }, [])

  return (
    <div className="border-t border-border bg-background px-4 py-3">
      {/* Reply preview */}
      {replyTo && (
        <div
          id="reply-preview"
          className="flex items-start gap-2 mb-2 rounded-lg border-l-[3px] border-primary bg-primary/5 dark:bg-primary/10 px-3 py-2"
        >
          <CornerUpRight className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-primary truncate">
              {replyTo.sender?.full_name ?? replyTo.sender?.email ?? "Unknown"}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {replyTo.type !== "text" ? `📎 ${replyTo.type}` : (replyTo.content ?? "media")}
            </p>
          </div>
          <button
            onClick={onClearReply}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-0.5"
            aria-label="Cancel reply"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div
        className={cn(
          "flex items-end gap-2 rounded-xl border border-border bg-background px-3 py-2 focus-within:border-primary transition-colors",
          uploading && "opacity-60 pointer-events-none",
        )}
      >
        {/* File attachment */}
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={handleFileChange}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground"
          onClick={() => fileRef.current?.click()}
          type="button"
        >
          <Paperclip className="h-4 w-4" />
        </Button>

        {/* Text area */}
        <textarea
          ref={textRef}
          value={text}
          onChange={(e) => { setText(e.target.value); onTyping() }}
          onKeyDown={handleKeyDown}
          placeholder="Message…"
          rows={1}
          aria-label="Message input"
          aria-describedby={replyPreviewId}
          className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground leading-relaxed overflow-hidden"
          style={{ minHeight: "1.5rem", maxHeight: "9rem" }}
        />

        {/* Emoji picker */}
        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground"
              type="button"
            >
              <Smile className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" side="top" className="p-0 border-0 shadow-lg w-auto">
            <EmojiPicker
              onEmojiClick={handleEmojiClick}
              height={380}
              emojiStyle={EmojiStyle.NATIVE}
              lazyLoadEmojis
            />
          </PopoverContent>
        </Popover>

        {/* Send */}
        <Button
          size="icon"
          className="h-8 w-8 shrink-0"
          disabled={!text.trim() || uploading}
          onClick={handleSend}
          type="button"
          aria-label="Send message"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>

      {pendingAttachment && (
        <div className="mt-2 flex items-start gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2">
          {pendingAttachment.previewUrl ? (
            <img
              src={pendingAttachment.previewUrl}
              alt={pendingAttachment.name}
              className="h-10 w-10 shrink-0 rounded-md object-cover"
            />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-background text-xs font-semibold text-muted-foreground">
              {pendingAttachment.type.startsWith("audio/")
                ? "A"
                : pendingAttachment.type.startsWith("video/")
                  ? "V"
                  : pendingAttachment.type === "application/pdf"
                    ? "PDF"
                    : "FILE"}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{pendingAttachment.name}</p>
            <p className="text-xs text-muted-foreground">
              {pendingAttachment.status === "uploading"
                ? "Uploading attachment..."
                : pendingAttachment.error ?? "Upload failed"}
            </p>
          </div>
          <button
            type="button"
            onClick={clearPendingAttachment}
            className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            aria-label={`Remove ${pendingAttachment.name}`}
          >
            {pendingAttachment.status === "uploading" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <X className="h-4 w-4" />
            )}
          </button>
        </div>
      )}
    </div>
  )
}
