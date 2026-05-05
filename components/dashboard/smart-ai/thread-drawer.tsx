"use client"

import { useEffect, useState, useCallback } from "react"
import {
  MessageSquare,
  Trash2,
  X,
  Loader2,
  Plus,
  Clock,
} from "lucide-react"
import { cn } from "@/lib/utils"

export interface ThreadSummary {
  id: string
  title: string
  created_at: string
  updated_at: string
  message_count: number
  last_message: {
    role: string
    content: string
    created_at: string
  } | null
}

interface ThreadDrawerProps {
  open?: boolean // Optional for sidebar variant
  onClose?: () => void // Optional for sidebar variant
  activeThreadId: string | null
  onSelectThread: (threadId: string) => void
  onNewConversation: () => void
  variant?: "drawer" | "sidebar"
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return "Just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

export function ThreadDrawer({
  open = true,
  onClose,
  activeThreadId,
  onSelectThread,
  onNewConversation,
  variant = "drawer",
}: ThreadDrawerProps) {
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchThreads = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/smart-ai/threads")
      if (res.ok) {
        const data = await res.json()
        setThreads(data.threads ?? [])
      }
    } catch (err) {
      console.error("[threads] fetch failed", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) fetchThreads()
  }, [open, fetchThreads])

  async function handleDelete(e: React.MouseEvent, threadId: string) {
    e.stopPropagation()
    if (deletingId) return
    setDeletingId(threadId)

    try {
      const res = await fetch(`/api/smart-ai/threads?id=${threadId}`, {
        method: "DELETE",
      })
      if (res.ok) {
        setThreads((prev) => prev.filter((t) => t.id !== threadId))
        // If we deleted the active thread, start a new conversation
        if (threadId === activeThreadId) {
          onNewConversation()
        }
      }
    } catch (err) {
      console.error("[threads] delete failed", err)
    } finally {
      setDeletingId(null)
    }
  }

  function handleSelect(threadId: string) {
    onSelectThread(threadId)
    onClose()
  }

  return (
    <>
      {/* Backdrop (Drawer only) */}
      {variant === "drawer" && open ? (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px] transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />
      ) : null}

      {/* Container panel */}
      <div
        className={cn(
          "flex flex-col bg-card overflow-hidden",
          variant === "drawer"
            ? "fixed top-1/2 left-1/2 z-50 w-[500px] max-h-[85vh] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 border border-border shadow-2xl rounded-2xl transition-all duration-200 ease-out"
            : "w-full h-full border-r border-border",
          variant === "drawer" && !open && "opacity-0 scale-95 pointer-events-none"
        )}
        role={variant === "drawer" ? "dialog" : "complementary"}
        aria-label="Chat history"
      >
        {/* Header */}
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#f2f9ff] text-[#097fe8]">
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold tracking-tight">
                Chat History
              </h2>
              <p className="text-[12px] text-muted-foreground">
                {threads.length} conversation{threads.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          {variant === "drawer" && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label="Close chat history"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </header>

        {/* New conversation button */}
        <div className="px-3 pt-3">
          <button
            type="button"
            onClick={() => {
              onNewConversation()
              if (onClose) onClose()
            }}
            className="flex w-full items-center gap-2.5 rounded-xl border border-dashed border-border px-3.5 py-2.5 text-[13px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground hover:border-foreground/15 transition-all"
          >
            <Plus className="h-4 w-4" />
            New conversation
          </button>
        </div>

        {/* Thread list */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-3 py-3 space-y-1">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              <span className="text-[13px]">Loading threads…</span>
            </div>
          ) : threads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <MessageSquare className="h-8 w-8 text-muted-foreground/40 mb-3" />
              <p className="text-[13px] text-muted-foreground">
                No conversations yet.
              </p>
              <p className="text-[12px] text-muted-foreground/70 mt-1">
                Start chatting and your threads will appear here.
              </p>
            </div>
          ) : (
            threads.map((thread) => {
              const isActive = thread.id === activeThreadId
              const preview =
                thread.last_message?.content?.slice(0, 80) ?? "Empty conversation"
              const time = thread.last_message?.created_at
                ? relativeTime(thread.last_message.created_at)
                : relativeTime(thread.updated_at)

              return (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => handleSelect(thread.id)}
                  className={cn(
                    "group flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-all",
                    isActive
                      ? "bg-primary/8 border border-primary/20"
                      : "hover:bg-muted border border-transparent",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg mt-0.5",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-warm-white text-foreground/60",
                    )}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p
                        className={cn(
                          "text-[13px] font-semibold truncate",
                          isActive ? "text-foreground" : "text-foreground/80",
                        )}
                      >
                        {thread.title}
                      </p>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[10.5px] text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {time}
                        </span>
                      </div>
                    </div>
                    <p className="text-[11.5px] text-muted-foreground line-clamp-2 mt-0.5 leading-snug">
                      {preview}
                    </p>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-[10.5px] text-muted-foreground/70">
                        {thread.message_count} message
                        {thread.message_count !== 1 ? "s" : ""}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => handleDelete(e, thread.id)}
                        disabled={deletingId === thread.id}
                        className="opacity-0 group-hover:opacity-100 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-[#fff1e6] hover:text-[#a4400a] transition-all"
                        aria-label={`Delete conversation: ${thread.title}`}
                        title="Delete conversation"
                      >
                        {deletingId === thread.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}
