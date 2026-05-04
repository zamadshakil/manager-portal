"use client"

import { useEffect, useRef, useState, useCallback, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, type UIMessage } from "ai"
import {
  ArrowUp,
  Sparkles,
  Database,
  FileText,
  ListChecks,
  ShieldCheck,
  Megaphone,
  Loader2,
  RefreshCcw,
  Trash2,
  User2,
  Paperclip,
  Search,
  Plus,
  History,
  Zap,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"
import type { Profile } from "@/lib/types"
import { ACCEPTED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from "@/lib/types"
import { FilePreview, type Attachment } from "./file-preview"
import { ThreadDrawer } from "./thread-drawer"

type ProfileLite = Pick<Profile, "id" | "email" | "full_name" | "role" | "team_id">

interface ChatPanelProps {
  profile: ProfileLite
  services: { mcp: boolean; rag: boolean }
  seedPrompt: string | null
  onSeedConsumed: () => void
}

interface SuggestedPrompt {
  icon: React.ComponentType<{ className?: string }>
  title: string
  prompt: string
  roles: ProfileLite["role"][]
}

// Typed message metadata that round-trips to the server. AI SDK 6 puts
// custom per-message context here (replaces v4's `annotations`).
interface PortalUIMessageMetadata {
  attachments?: Array<{ id: string; filename: string }>
}

type PortalUIMessage = UIMessage<PortalUIMessageMetadata>

const SUGGESTIONS: SuggestedPrompt[] = [
  {
    icon: FileText,
    title: "Summarize last week's submissions",
    prompt:
      "Summarize the last 7 days of submissions across the team. Group by status, call out any failures, and surface the top reviewer follow-ups.",
    roles: ["main_admin", "manager"],
  },
  {
    icon: ShieldCheck,
    title: "Which validation rules fail most?",
    prompt:
      "Which validation rules have the highest failure rate in the last 30 days? List them with example failing submissions.",
    roles: ["main_admin", "manager"],
  },
  {
    icon: ListChecks,
    title: "What tasks are still open for me?",
    prompt:
      "Show me my open tasks with due dates, and explain what's required for each one based on the task instructions.",
    roles: ["main_admin", "manager", "member"],
  },
  {
    icon: Megaphone,
    title: "Recent announcements",
    prompt:
      "Catch me up on the most recent announcements from administrators and managers. Surface anything urgent.",
    roles: ["main_admin", "manager", "member"],
  },
  {
    icon: Database,
    title: "How is the team performing?",
    prompt:
      "Give me a one-paragraph performance recap for my team this month: average score, pass rate, late submissions, and trend versus last month.",
    roles: ["main_admin", "manager"],
  },
  {
    icon: FileText,
    title: "Explain my latest submission",
    prompt:
      "Explain the validation results for my most recent submission. What did the rules check, what passed, what failed, and how can I improve?",
    roles: ["member"],
  },
]

// Per-user localStorage key so two users on the same browser never share a thread.
function threadIdKey(userId: string) {
  return `smart_ai:thread_id:${userId}`
}

const ACCEPT_ATTR = (ACCEPTED_MIME_TYPES as readonly string[]).join(",")

export function ChatPanel(props: ChatPanelProps) {
  return (
    <Suspense fallback={<div className="flex h-[560px] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
      <ChatPanelInner {...props} />
    </Suspense>
  )
}

function ChatPanelInner({
  profile,
  services,
  seedPrompt,
  onSeedConsumed,
}: ChatPanelProps) {
  const [input, setInput] = useState("")
  const [threadId, setThreadId] = useState<string | null>(null)
  const threadIdRef = useRef<string | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [loadingThread, setLoadingThread] = useState(false)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const router = useRouter()
  const searchParams = useSearchParams()
  const threadParam = searchParams.get("thread")

  // Keep the ref in sync so the transport callback below always reads
  // the LATEST threadId — useChat captures its options once on mount.
  threadIdRef.current = threadId

  // Build the transport once. The `prepareSendMessagesRequest` hook reads
  // the current threadId on every send, so reseting the conversation works
  // without re-creating the transport (which would also reset useChat).
  const transportRef = useRef<DefaultChatTransport<PortalUIMessage> | null>(null)
  if (!transportRef.current) {
    transportRef.current = new DefaultChatTransport<PortalUIMessage>({
      api: "/api/smart-ai/chat",
      prepareSendMessagesRequest: ({ messages, body }) => ({
        body: {
          ...(body ?? {}),
          messages,
          threadId: threadIdRef.current,
        },
      }),
    })
  }

  const { messages, sendMessage, setMessages, status, error, regenerate, stop } =
    useChat<PortalUIMessage>({
      transport: transportRef.current,
    })

  // Load messages from a persisted thread
  const loadThread = useCallback(
    async (id: string) => {
      setLoadingThread(true)
      try {
        const res = await fetch(`/api/smart-ai/threads/${id}/messages`)
        if (!res.ok) throw new Error(`Failed: ${res.status}`)
        const data = await res.json()
        const msgs = (data.messages ?? []) as PortalUIMessage[]
        setMessages(msgs)
        setThreadId(id)
        localStorage.setItem(threadIdKey(profile.id), id)

        const params = new URLSearchParams(searchParams.toString())
        if (params.get("thread") !== id) {
          params.set("thread", id)
          router.replace("?" + params.toString(), { scroll: false })
        }
      } catch (err) {
        console.error("[chat] failed to load thread:", err)
      } finally {
        setLoadingThread(false)
      }
    },
    [profile.id, setMessages, searchParams, router],
  )

  // Mint or restore a per-user thread ID on mount.
  useEffect(() => {
    const key = threadIdKey(profile.id)

    // Case 1: A thread is specified in the URL
    if (threadParam) {
      if (threadParam !== threadIdRef.current) {
        loadThread(threadParam)
      }
      return
    }

    // Case 2: No thread in URL, restore from storage or create new
    if (!threadIdRef.current) {
      const stored = localStorage.getItem(key)
      const params = new URLSearchParams(searchParams.toString())
      if (stored) {
        setThreadId(stored)
        params.set("thread", stored)
        router.replace("?" + params.toString(), { scroll: false })
      } else {
        const newId = crypto.randomUUID()
        localStorage.setItem(key, newId)
        setThreadId(newId)
        params.set("thread", newId)
        router.replace("?" + params.toString(), { scroll: false })
      }
    }
  }, [profile.id, threadParam, loadThread, searchParams, router])

  // Auto-stick to the bottom whenever new tokens arrive.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, status])

  // Honor a seed prompt jumped in from another tab.
  useEffect(() => {
    if (!seedPrompt) return
    sendMessage({ text: seedPrompt })
    onSeedConsumed()
  }, [seedPrompt, sendMessage, onSeedConsumed])

  const visibleSuggestions = SUGGESTIONS.filter((s) =>
    s.roles.includes(profile.role),
  )

  const isStreaming = status === "streaming" || status === "submitted"

  function startNewConversation() {
    const newId = crypto.randomUUID()
    localStorage.setItem(threadIdKey(profile.id), newId)
    setThreadId(newId)
    setMessages([])
    setAttachments([])
    setUploadError(null)

    const params = new URLSearchParams(searchParams.toString())
    params.set("thread", newId)
    router.replace("?" + params.toString(), { scroll: false })
  }

  async function handleUpload(file: File) {
    // Client-side validation — defense in depth; the server validates too.
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setUploadError(
        `${file.name} is too large (max ${Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024))} MB).`,
      )
      return
    }
    if (file.type && !(ACCEPTED_MIME_TYPES as readonly string[]).includes(file.type)) {
      setUploadError(`${file.name}: unsupported file type (${file.type}).`)
      return
    }

    const tempId = crypto.randomUUID()
    setUploadError(null)
    setAttachments((prev) => [
      ...prev,
      { id: tempId, filename: file.name, status: "uploading" },
    ])

    try {
      const formData = new FormData()
      formData.append("file", file)
      if (threadId) formData.append("thread_id", threadId)

      const res = await fetch("/api/smart-ai/upload", {
        method: "POST",
        body: formData,
      })

      if (!res.ok) {
        const detail = await res.json().catch(() => null)
        throw new Error(detail?.error || `Upload failed (${res.status})`)
      }

      const data = (await res.json()) as {
        id: string
        file_name: string
        file_url: string
        rag_status: "completed" | "failed" | "skipped"
        warning?: string
      }

      setAttachments((prev) =>
        prev.map((a) =>
          a.id === tempId
            ? {
              id: data.id,
              filename: data.file_name,
              status: data.rag_status === "failed" ? "error" : "ready",
              url: data.file_url,
            }
            : a,
        ),
      )

      if (data.rag_status === "failed" || data.warning) {
        setUploadError(
          data.warning ??
          `${data.file_name} was uploaded but indexing failed. The AI may not be able to read its contents.`,
        )
      }
    } catch (err: any) {
      console.error("Upload failed:", err)
      setAttachments((prev) =>
        prev.map((a) => (a.id === tempId ? { ...a, status: "error" } : a)),
      )
      setUploadError(err?.message ?? "Upload failed.")
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    files.forEach(handleUpload)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(true)
  }

  function onDragLeave(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files)
    files.forEach(handleUpload)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = input.trim()
    const readyAttachments = attachments.filter((a) => a.status === "ready")

    if ((!trimmed && readyAttachments.length === 0) || isStreaming) return

    const metadata: PortalUIMessageMetadata | undefined =
      readyAttachments.length > 0
        ? {
          attachments: readyAttachments.map((a) => ({
            id: a.id,
            filename: a.filename,
          })),
        }
        : undefined

    sendMessage({
      text: trimmed || `[Attached ${readyAttachments.length} file(s)]`,
      metadata,
    })

    setInput("")
    setAttachments([])
    setUploadError(null)
  }

  function handleSuggestion(p: SuggestedPrompt) {
    if (isStreaming) return
    sendMessage({ text: p.prompt })
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 lg:gap-6 min-w-0">
      {/* Conversation */}
      <section
        aria-label="Conversation"
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          "xl:col-span-2 flex flex-col rounded-xl border border-border bg-card shadow-card overflow-hidden min-h-[560px] transition-colors relative",
          isDragging && "bg-primary/5 border-primary/30",
        )}
      >
        {isDragging ? (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/10 backdrop-blur-[2px] pointer-events-none">
            <div className="flex flex-col items-center gap-3 rounded-2xl bg-background px-8 py-6 shadow-2xl border border-primary/20">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <ArrowUp className="h-6 w-6" />
              </div>
              <p className="text-[15px] font-semibold text-foreground">
                Drop files to index and discuss
              </p>
            </div>
          </div>
        ) : null}
        {/* Thread drawer */}
        <ThreadDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          activeThreadId={threadId}
          onSelectThread={loadThread}
          onNewConversation={startNewConversation}
        />

        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5 lg:px-5">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#f2f9ff] text-[#097fe8]">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold tracking-tight">
                Smart AI Assistant
              </h2>
              <div className="flex items-center gap-1.5">
                <p className="text-[12px] text-muted-foreground truncate">
                  {services.mcp
                    ? "Connected to MCP · grounded in your portal data"
                    : "Direct mode · querying your portal data"}
                </p>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                    services.mcp
                      ? "bg-[#e8f8eb] text-[#157a2a]"
                      : "bg-[#f2f9ff] text-[#097fe8]",
                  )}
                >
                  {services.mcp ? (
                    <Zap className="h-2.5 w-2.5" />
                  ) : (
                    <Database className="h-2.5 w-2.5" />
                  )}
                  {services.mcp ? "RAG" : "SQL"}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="View chat history"
            >
              <History className="h-3.5 w-3.5" aria-hidden="true" />
              History
            </button>
            <button
              type="button"
              onClick={startNewConversation}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Start a new conversation"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              New
            </button>
            {messages.length > 0 ? (
              <button
                type="button"
                onClick={() => setMessages([])}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                title="Clear conversation view"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Clear
              </button>
            ) : null}
          </div>
        </header>

        {/* Scroll area */}
        <div
          ref={scrollerRef}
          className="flex-1 overflow-y-auto scrollbar-thin px-4 py-5 lg:px-6 lg:py-6 space-y-5"
        >
          {loadingThread ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              <span className="text-[13px]">Loading conversation…</span>
            </div>
          ) : messages.length === 0 ? (
            <EmptyState
              profile={profile}
              suggestions={visibleSuggestions}
              onPick={handleSuggestion}
            />
          ) : (
            messages.map((m) => (
              <Message
                key={m.id}
                message={m}
                userName={profile.full_name ?? profile.email}
              />
            ))
          )}

          {status === "submitted" ? (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Retrieving context…
            </div>
          ) : null}

          {error ? (
            <div className="rounded-lg border border-[#dd5b00]/20 bg-[#fff1e6] px-3 py-2.5 text-[12.5px] text-[#a4400a]">
              <strong className="font-semibold">Something went wrong.</strong>{" "}
              {error.message}
              <button
                type="button"
                onClick={() => regenerate()}
                className="ml-2 inline-flex items-center gap-1 font-semibold underline hover:no-underline"
              >
                <RefreshCcw className="h-3 w-3" />
                Retry
              </button>
            </div>
          ) : null}
        </div>

        {/* Composer */}
        <form
          onSubmit={handleSubmit}
          className="border-t border-border bg-background/50 px-3 py-3 lg:px-4 lg:py-4"
        >
          <div className="rounded-xl border border-border bg-background shadow-sm focus-within:ring-2 focus-within:ring-ring focus-within:border-ring transition-all">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  handleSubmit(e as unknown as React.FormEvent)
                }
              }}
              placeholder="Ask about submissions, tasks, validation rules, or team performance…"
              rows={2}
              className="w-full resize-none bg-transparent px-3.5 py-2.5 text-[14px] leading-relaxed placeholder:text-muted-foreground focus:outline-none"
              aria-label="Message Smart AI"
            />
            <FilePreview
              attachments={attachments}
              onRemove={(id) =>
                setAttachments((prev) => prev.filter((a) => a.id !== id))
              }
            />
            {uploadError ? (
              <p className="px-3.5 pb-2 text-[11.5px] text-[#a4400a]">
                {uploadError}
              </p>
            ) : null}
            <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5">
              <div className="flex items-center gap-1">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  className="hidden"
                  accept={ACCEPT_ATTR}
                  multiple
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  aria-label="Attach files"
                  title="Attach documents"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                <p className="text-[11px] text-muted-foreground">
                  <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
                    Enter
                  </kbd>{" "}
                  to send ·{" "}
                  <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
                    Shift + Enter
                  </kbd>{" "}
                  for newline
                </p>
              </div>
              {isStreaming ? (
                <button
                  type="button"
                  onClick={() => stop()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-[12px] font-semibold text-foreground hover:bg-muted/70 transition-colors"
                >
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={
                    !input.trim() &&
                    attachments.filter((a) => a.status === "ready").length === 0
                  }
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-all hover:bg-[#005bab] active:scale-[0.95] disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
                  aria-label="Send message"
                >
                  <ArrowUp className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </form>
      </section>

      {/* Sidebar — capabilities + sources */}
      <aside className="space-y-4 lg:space-y-5 min-w-0">
        <CapabilitiesCard role={profile.role} />
        <KnowledgeCard services={services} />
      </aside>
    </div>
  )
}

function EmptyState({
  profile,
  suggestions,
  onPick,
}: {
  profile: ProfileLite
  suggestions: SuggestedPrompt[]
  onPick: (p: SuggestedPrompt) => void
}) {
  const greeting = profile.full_name?.split(" ")[0] ?? "there"
  return (
    <div className="flex flex-col items-center text-center py-8 lg:py-12">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f2f9ff] text-[#097fe8] mb-4 shadow-card">
        <Sparkles className="h-6 w-6" aria-hidden="true" />
      </span>
      <h3 className="text-[20px] font-semibold tracking-tight">
        Hi {greeting}, what can I help you find?
      </h3>
      <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground max-w-md">
        I&apos;m grounded in your portal&apos;s submissions, tasks, validation runs, and audit
        log. Ask anything in plain English.
      </p>

      <div className="mt-7 grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-2xl text-left">
        {suggestions.map((s) => {
          const Icon = s.icon
          return (
            <button
              key={s.title}
              type="button"
              onClick={() => onPick(s)}
              className="group flex items-start gap-3 rounded-xl border border-border bg-background px-3.5 py-3 text-left transition-all hover:border-foreground/15 hover:shadow-card"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warm-white text-foreground/70 group-hover:bg-[#f2f9ff] group-hover:text-[#097fe8] transition-colors">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold leading-snug">{s.title}</p>
                <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground line-clamp-2">
                  {s.prompt}
                </p>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Message({ message, userName }: { message: PortalUIMessage; userName: string }) {
  const isUser = message.role === "user"
  const text = (message.parts ?? [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("")

  // Surface tool invocations so users see what the agent is doing instead
  // of a perpetual "Thinking…" while a tool runs.
  const toolParts = (message.parts ?? []).filter((p) => {
    const t = (p as any).type
    return typeof t === "string" && (t.startsWith("tool-") || t === "dynamic-tool")
  }) as Array<{ type: string;[k: string]: any }>


  return (
    <div className={cn("flex items-start gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[12px] font-semibold",
          isUser ? "bg-warm-white text-foreground" : "bg-[#f2f9ff] text-[#097fe8]",
        )}
        aria-hidden="true"
      >
        {isUser ? <User2 className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
      </span>
      <div
        className={cn(
          "max-w-[85%] space-y-2",
          isUser ? "items-end" : "items-start",
        )}
      >
        {/* Tool calls (assistant only) */}
        {!isUser && toolParts.length > 0 ? (
          <div className="space-y-1.5">
            {toolParts.map((p, idx) => (
              <ToolBadge key={`tool-${idx}`} part={p} />
            ))}
          </div>
        ) : null}

        {/* Attachments echo on user turns */}
        {isUser && message.metadata?.attachments?.length ? (
          <div className="flex flex-wrap gap-1.5 justify-end">
            {message.metadata.attachments.map((a) => (
              <span
                key={a.id}
                className="inline-flex items-center gap-1 rounded-md bg-warm-white px-2 py-0.5 text-[11px] font-medium text-foreground/80"
              >
                <FileText className="h-3 w-3" aria-hidden="true" />
                {a.filename}
              </span>
            ))}
          </div>
        ) : null}

        {/* Text bubble */}
        {text || (!isUser && toolParts.length === 0) ? (
          <div
            className={cn(
              "rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed max-w-[100%]",
              isUser
                ? "bg-primary text-primary-foreground rounded-tr-md whitespace-pre-wrap"
                : "bg-warm-white text-foreground rounded-tl-md",
              !isUser && "prose prose-sm max-w-none prose-p:my-1.5 prose-p:leading-relaxed prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:bg-black/5 prose-pre:text-foreground prose-code:text-foreground prose-code:bg-black/5 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-table:border-border prose-th:border-border prose-td:border-border prose-tr:border-b-border"
            )}
          >
            <span className="sr-only">
              {isUser ? `${userName} said:` : "Smart AI replied:"}
            </span>
            {text ? (
              isUser ? (
                text
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
              )
            ) : (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                Thinking…
              </span>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ToolBadge({ part }: { part: { type: string;[k: string]: any } }) {
  // AI SDK 6 names tool parts `tool-<toolName>` for static tools and emits
  // `dynamic-tool` for dynamically-registered ones. Each part has a
  // `state` field that tells us whether it's input-streaming, executing,
  // or done.
  const name =
    part.type === "dynamic-tool"
      ? (part.toolName as string) ?? "tool"
      : part.type.replace(/^tool-/, "")
  const state = (part.state as string) ?? "executing"
  const isDone = state === "output-available" || state === "result"
  const isError = state === "output-error" || state === "error"

  const label =
    name === "searchDocument"
      ? "Searching documents"
      : name === "queryDatabase"
        ? "Querying database"
        : name === "insertRecord"
          ? "Inserting record"
          : name === "updateRecord"
            ? "Updating record"
            : `Calling ${name}`

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
        isError
          ? "bg-[#fff1e6] text-[#a4400a]"
          : isDone
            ? "bg-[#e8f8eb] text-[#157a2a]"
            : "bg-[#f2f9ff] text-[#097fe8]",
      )}
    >
      {isDone || isError ? (
        <Search className="h-3 w-3" aria-hidden="true" />
      ) : (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      )}
      {label}
      {isError ? " · failed" : isDone ? "" : "…"}
    </span>
  )
}

function CapabilitiesCard({ role }: { role: ProfileLite["role"] }) {
  const items = [
    { label: "Read your submissions", scope: "always" },
    { label: "Cite source documents", scope: "always" },
    {
      label: "Cross-team analytics",
      scope: role === "main_admin" ? "yes" : "no",
    },
    { label: "Reviewer follow-ups", scope: role !== "member" ? "yes" : "no" },
    { label: "Validation rule diagnostics", scope: role !== "member" ? "yes" : "no" },
  ]
  return (
    <section
      aria-labelledby="smart-ai-capabilities"
      className="rounded-xl border border-border bg-card shadow-card"
    >
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 lg:px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-warm-white">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 id="smart-ai-capabilities" className="text-[14.5px] font-semibold tracking-tight">
            What I can do for you
          </h3>
          <p className="text-[11.5px] text-muted-foreground">
            Capabilities are scoped to your role.
          </p>
        </div>
      </header>
      <ul className="px-4 py-3 lg:px-5 lg:py-4 space-y-2">
        {items.map((it) => (
          <li
            key={it.label}
            className="flex items-center justify-between gap-3 text-[12.5px]"
          >
            <span className="text-foreground/80">{it.label}</span>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.04em]",
                it.scope === "no"
                  ? "bg-muted text-muted-foreground"
                  : "bg-[#f2f9ff] text-[#097fe8]",
              )}
            >
              {it.scope === "no" ? "Limited" : "Yes"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function KnowledgeCard({ services }: { services: { mcp: boolean; rag: boolean } }) {
  const sources = [
    { label: "Submissions", icon: FileText },
    { label: "Tasks & assignments", icon: ListChecks },
    { label: "Validation rules", icon: ShieldCheck },
    { label: "Announcements", icon: Megaphone },
    { label: "Activity log", icon: Database },
  ]
  return (
    <section
      aria-labelledby="smart-ai-knowledge"
      className="rounded-xl border border-border bg-card shadow-card"
    >
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 lg:px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-warm-white">
          <Database className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 id="smart-ai-knowledge" className="text-[14.5px] font-semibold tracking-tight">
            Knowledge sources
          </h3>
          <p className="text-[11.5px] text-muted-foreground">
            Indexed in pgvector via the RAG service.
          </p>
        </div>
      </header>
      <ul className="px-4 py-3 lg:px-5 lg:py-4 space-y-2">
        {sources.map((s) => {
          const Icon = s.icon
          return (
            <li key={s.label} className="flex items-center gap-2.5 text-[12.5px]">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-warm-white text-foreground/70">
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <span className="flex-1 truncate">{s.label}</span>
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
                  services.rag
                    ? "bg-[#e8f8eb] text-[#157a2a]"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {services.rag ? "Indexed" : "Pending"}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
