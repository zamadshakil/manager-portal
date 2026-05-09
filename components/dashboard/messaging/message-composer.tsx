"use client"

import { useRef, useState, useCallback, useEffect } from "react"
import { Send, Paperclip, Smile, X, Loader2 } from "lucide-react"
import EmojiPicker, { EmojiStyle, type EmojiClickData } from "emoji-picker-react"
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

const ACCEPT = [
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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
  const fileRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea on every text change
  useEffect(() => {
    const el = textRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`
  }, [text])

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
    setUploading(true)
    try {
      // 1. Get presigned URL
      const res = await fetch("/api/messaging/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          fileName: file.name,
          contentType: file.type,
          size: file.size,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      const { uploadUrl, publicUrl } = await res.json()

      // 2. PUT directly to R2
      await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      })

      // 3. Determine message type
      let msgType: string
      if (file.type.startsWith("image/")) msgType = "image"
      else if (file.type.startsWith("audio/")) msgType = "audio"
      else if (file.type.startsWith("video/")) msgType = "video"
      else msgType = "file"

      onSend({
        type: msgType,
        media_url: publicUrl,
        media_metadata: { name: file.name, size: file.size, contentType: file.type },
        reply_to_id: replyTo?.id,
      })
      onClearReply()
    } catch (err) {
      console.error("[upload]", err)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="border-t border-border bg-background px-4 py-3">
      {/* Reply preview */}
      {replyTo && (
        <div className="flex items-center gap-2 mb-2 rounded-lg bg-accent/50 px-3 py-1.5 text-sm">
          <span className="text-muted-foreground flex-1 truncate">
            Replying to <strong>{replyTo.sender?.full_name ?? "…"}</strong>:{" "}
            {replyTo.content ?? "media"}
          </span>
          <button onClick={onClearReply} className="text-muted-foreground hover:text-foreground">
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
    </div>
  )
}
