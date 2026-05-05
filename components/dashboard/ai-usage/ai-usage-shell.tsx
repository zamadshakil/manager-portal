"use client"

import { useState } from "react"
import { BrainCircuit, BarChart3, CreditCard, ScrollText } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AiCreditLimit } from "@/lib/types"
import { UsageOverviewPanel } from "./usage-overview-panel"
import { CreditManagementPanel } from "./credit-management-panel"
import { TrackRecordPanel } from "./track-record-panel"

type Tab = "overview" | "credits" | "records"

interface Props {
  creditLimits: AiCreditLimit[]
  usageTrend: Array<{ day: string; count: number }>
  adminProfile: {
    id: string
    email: string
    full_name: string | null
    role: string
  }
}

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "credits", label: "Credit Management", icon: CreditCard },
  { id: "records", label: "Track Records", icon: ScrollText },
]

export function AiUsageShell({ creditLimits, usageTrend, adminProfile }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("overview")

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg shadow-violet-500/25">
          <BrainCircuit className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI &amp; Usage</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Monitor AI consumption, set credit limits, and review per-user usage history.
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === "overview" && (
          <UsageOverviewPanel creditLimits={creditLimits} usageTrend={usageTrend} />
        )}
        {activeTab === "credits" && (
          <CreditManagementPanel creditLimits={creditLimits} />
        )}
        {activeTab === "records" && (
          <TrackRecordPanel creditLimits={creditLimits} />
        )}
      </div>
    </div>
  )
}
