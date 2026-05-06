"use client"

import { useState } from "react"
import { ShieldCheck, BarChart3, CreditCard, ScrollText, TableProperties } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AiCreditLimit } from "@/lib/types"
import { UsageOverviewPanel } from "./usage-overview-panel"
import { CreditManagementPanel } from "./credit-management-panel"
import { TrackRecordPanel } from "./track-record-panel"
import { TransactionLedger } from "./transaction-ledger"

type Tab = "overview" | "credits" | "records" | "ledger"

interface Props {
  creditLimits: AiCreditLimit[]
  usageTrend: Array<{ day: string; count: number }>
  ledger: any[]
  totalMessages: number
  adminProfile: {
    id: string
    email: string
    full_name: string | null
    role: string
  }
}

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "overview", label: "Executive Overview", icon: BarChart3 },
  { id: "ledger", label: "Transaction Ledger", icon: TableProperties },
  { id: "credits", label: "Consumption Controls", icon: CreditCard },
  { id: "records", label: "User Track Records", icon: ScrollText },
]

export function AiUsageShell({ creditLimits, usageTrend, ledger, totalMessages, adminProfile }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("overview")

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Page header */}
      <div className="flex items-start gap-4 p-6 rounded-2xl bg-gradient-to-br from-slate-900 to-indigo-950 text-white shadow-xl">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-md shadow-inner border border-white/20">
          <ShieldCheck className="h-7 w-7 text-indigo-300" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-indigo-200">
            Main Admin Executive Dashboard
          </h1>
          <p className="text-indigo-200/80 mt-1 max-w-2xl text-sm">
            Central authority portal for AI economy and resource allocation. Monitor real-time audit trails, enforce consumption thresholds, and review granular transaction ledgers for every credit-consuming event.
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border overflow-x-auto pb-px">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition-all whitespace-nowrap",
                active
                  ? "border-indigo-600 text-indigo-700 bg-indigo-50/50"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border hover:bg-muted/30",
              )}
            >
              <Icon className={cn("h-4 w-4", active ? "text-indigo-600" : "")} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div className="pt-2">
        {activeTab === "overview" && (
          <UsageOverviewPanel creditLimits={creditLimits} usageTrend={usageTrend} totalMessages={totalMessages} />
        )}
        {activeTab === "ledger" && (
          <TransactionLedger ledger={ledger} />
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
