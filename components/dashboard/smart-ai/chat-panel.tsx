"use client"

import { useEffect, useRef, useState } from "react"
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
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { Profile } from "@/lib/types"

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

export function ChatPanel({
  profile,
  services,
  seedPrompt,
  onSeedConsumed,
}: ChatPanelProps) {
  const [input, setInput] = useState("")
  const scrollerRef = useRef<HTMLDivElement>(null)

  const { messages, sendMessage, setMessages, status, error, regenerate, stop } =
    useChat({
      transport: new DefaultChatTransport({ api: "/api/smart-ai/chat" }),
    })

  // Auto-stick to bottom whenever new tokens arrive.
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

  const visibleSuggestions = SUGGESTIONS.filter((s) => s.roles.includes(profile.role))

  const isStreaming = status === "streaming" || status === "submitted"

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || isStreaming) return
    sendMessage({ text: trimmed })
    setInput("")
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
        className="xl:col-span-2 flex flex-col rounded-xl border border-border bg-card shadow-card overflow-hidden min-h-[560px]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5 lg:px-5">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#f2f9ff] text-[#097fe8]">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold tracking-tight">Smart AI Assistant</h2>
              <p className="text-[12px] text-muted-foreground truncate">
                {services.mcp
                  ? "Connected to MCP · grounded in your portal data"
                  : "Fallback mode · connect MCP_SERVICE_URL for full RAG retrieval"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 ? (
              <button
                type="button"
                onClick={() => setMessages([])}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                title="Clear conversation"
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
          {messages.length === 0 ? (
            <EmptyState
              profile={profile}
              suggestions={visibleSuggestions}
              onPick={handleSuggestion}
            />
          ) : (
            messages.map((m) => (
              <Message key={m.id} message={m} userName={profile.full_name ?? profile.email} />
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
              <strong className="font-semibold">Something went wrong.</strong> {error.message}
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
            <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5">
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
                  disabled={!input.trim()}
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

function Message({ message, userName }: { message: UIMessage; userName: string }) {
  const isUser = message.role === "user"
  const text = (message.parts ?? [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("")

  return (
    <div className={cn("flex items-start gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[12px] font-semibold",
          isUser
            ? "bg-warm-white text-foreground"
            : "bg-[#f2f9ff] text-[#097fe8]",
        )}
        aria-hidden="true"
      >
        {isUser ? (
          <User2 className="h-3.5 w-3.5" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
      </span>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap",
          isUser
            ? "bg-primary text-primary-foreground rounded-tr-md"
            : "bg-warm-white text-foreground rounded-tl-md",
        )}
      >
        <span className="sr-only">
          {isUser ? `${userName} said:` : "Smart AI replied:"}
        </span>
        {text || (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            Thinking…
          </span>
        )}
      </div>
    </div>
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
