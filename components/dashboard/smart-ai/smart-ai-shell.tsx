"use client"

import { useState, useEffect } from "react"
import { createPortal } from "react-dom"
import {
  Sparkles,
  MessageSquare,
  FileText,
  BarChart3,
  CheckCircle2,
  AlertCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { roleLabel } from "@/lib/auth-shared"
import { ChatPanel } from "@/components/dashboard/smart-ai/chat-panel"
import { SubmissionsReviewPanel } from "@/components/dashboard/smart-ai/submissions-review-panel"
import { AnalyticsPanel } from "@/components/dashboard/smart-ai/analytics-panel"
import type { Profile, Submission } from "@/lib/types"

type TabId = "chat" | "submissions" | "analytics"

type ProfileLite = Pick<Profile, "id" | "email" | "full_name" | "role" | "team_id">

interface SmartAiShellProps {
  profile: ProfileLite
  submissions: Submission[]
  services: { mcp: boolean; rag: boolean }
  initialThreadId?: string | null
}

const TABS: {
  id: TabId
  label: string
  icon: React.ComponentType<{ className?: string }>
  description: string
}[] = [
  {
    id: "chat",
    label: "Assistant",
    icon: MessageSquare,
    description: "Ask questions about submissions, tasks, validation rules, and team performance.",
  },
  {
    id: "submissions",
    label: "Submissions Review",
    icon: FileText,
    description: "Browse PDFs and images with one-click AI summaries grounded in retrieved context.",
  },
  {
    id: "analytics",
    label: "Insights & Logs",
    icon: BarChart3,
    description: "Retrieval analytics, query volume, latency, and an audit trail of recent questions.",
  },
]

export function SmartAiShell({ profile, submissions, services, initialThreadId }: SmartAiShellProps) {
  const [active, setActive] = useState<TabId>("chat")
  const [seedPrompt, setSeedPrompt] = useState<string | null>(null)

  const [portalTarget, setPortalTarget] = useState<Element | null>(null)

  useEffect(() => {
    setPortalTarget(document.getElementById("topbar-portal-target"))
  }, [])

  function jumpToChat(prompt: string) {
    setSeedPrompt(prompt)
    setActive("chat")
  }

  const tabsContent = (
    <div
      role="tablist"
      aria-label="Smart AI sections"
      className="flex items-center gap-1 rounded-xl border border-border bg-card p-1 shadow-sm overflow-x-auto scrollbar-thin"
    >
      {TABS.map((tab) => {
        const Icon = tab.icon
        const isActive = active === tab.id
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            aria-controls={`smartai-${tab.id}`}
            onClick={() => setActive(tab.id)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold whitespace-nowrap transition-all",
              isActive
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {tab.label}
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] -mb-12">
      {portalTarget ? createPortal(tabsContent, portalTarget) : tabsContent}

      {/* Panels */}
      <div
        id={`smartai-${active}`}
        role="tabpanel"
        aria-labelledby={`smartai-tab-${active}`}
        className="min-w-0"
      >
        {active === "chat" ? (
          <ChatPanel
            profile={profile}
            services={services}
            seedPrompt={seedPrompt}
            onSeedConsumed={() => setSeedPrompt(null)}
            initialThreadId={initialThreadId}
          />
        ) : null}
        {active === "submissions" ? (
          <SubmissionsReviewPanel
            submissions={submissions}
            onAskAi={(s) =>
              jumpToChat(
                `Summarize submission "${s.title}" (id ${s.id}). Highlight validation flags, score, and any reviewer follow-ups.`,
              )
            }
          />
        ) : null}
        {active === "analytics" ? <AnalyticsPanel /> : null}
      </div>
    </div>
  )
}

function ServiceBadge({ label, connected }: { label: string; connected: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
        connected
          ? "bg-[#e8f8eb] text-[#157a2a]"
          : "bg-[#fff8e1] text-[#7a5b00]",
      )}
      title={connected ? `${label} service connected` : `${label} service not yet wired`}
    >
      {connected ? (
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
      ) : (
        <AlertCircle className="h-3 w-3" aria-hidden="true" />
      )}
      {label}
    </span>
  )
}
