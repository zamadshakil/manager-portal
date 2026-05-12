"use client"

import { Zap, Clock, TrendingUp, Activity, CheckCircle2, XCircle, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AiCreditPeriod, AiUsageLogEntry } from "@/lib/types"

interface CreditStatus {
  used: number
  limit: number
  remaining: number
  periodType: AiCreditPeriod
  periodEnd: string
  isUnlimited: boolean
}

interface Props {
  credits: CreditStatus | null
  history: AiUsageLogEntry[]
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatResetDate(isoDate: string) {
  return new Date(isoDate + "T00:00:00").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  })
}

function formatModel(model: string | null) {
  if (!model) return "—"
  // Strip provider prefix: "anthropic/claude-sonnet-4-5" → "Claude Sonnet 4.5"
  const name = model.split("/").pop() ?? model
  return name
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatEventType(type: string | null) {
  if (!type) return "AI Query"
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function StatusIcon({ status }: { status: string | null }) {
  if (status === "success" || !status) {
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
  }
  if (status === "error" || status === "failed") {
    return <XCircle className="h-3.5 w-3.5 text-red-500" />
  }
  return <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
}

export function MyCreditsView({ credits, history }: Props) {
  const pct = credits && !credits.isUnlimited && credits.limit > 0
    ? (credits.remaining / credits.limit) * 100
    : 100

  const barColor =
    pct <= 10
      ? "bg-red-500"
      : pct <= 30
      ? "bg-amber-500"
      : "bg-emerald-500"

  const badgeColor =
    pct <= 10
      ? "bg-red-50 border-red-200 text-red-700"
      : pct <= 30
      ? "bg-amber-50 border-amber-200 text-amber-700"
      : "bg-emerald-50 border-emerald-200 text-emerald-700"

  const totalUsedThisPeriod = credits?.used ?? 0
  const totalHistoryCredits = history.reduce((s, r) => s + (r.credits_deducted ?? 1), 0)

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* Page header */}
      <div className="flex items-start gap-4 p-6 rounded-2xl bg-gradient-to-br from-slate-900 to-indigo-950 text-white shadow-xl">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-md shadow-inner border border-white/20">
          <Zap className="h-7 w-7 text-indigo-300" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-indigo-200">
            My AI Credits
          </h1>
          <p className="text-indigo-200/80 mt-1 text-sm">
            Your current credit balance and personal AI usage history for the last 30 days.
          </p>
        </div>
      </div>

      {/* Balance card */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Main balance */}
        <div className="sm:col-span-2 rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              <TrendingUp className="h-4 w-4" />
              Credit Balance
            </div>
            {credits?.isUnlimited ? (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 border border-indigo-200 text-indigo-700">
                Unlimited
              </span>
            ) : (
              <span className={cn("px-2.5 py-0.5 rounded-full text-xs font-semibold border", badgeColor)}>
                {Math.round(pct)}% remaining
              </span>
            )}
          </div>

          {credits?.isUnlimited ? (
            <div>
              <p className="text-4xl font-bold text-foreground">∞</p>
              <p className="text-sm text-muted-foreground mt-1">No credit limit set for your account</p>
            </div>
          ) : credits ? (
            <div className="space-y-3">
              <div className="flex items-end gap-2">
                <span className="text-4xl font-bold text-foreground">{credits.remaining.toLocaleString()}</span>
                <span className="text-lg text-muted-foreground mb-1">/ {credits.limit.toLocaleString()} remaining</span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", barColor)}
                  style={{ width: `${Math.max(1, pct)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {credits.used.toLocaleString()} credits used this {credits.periodType} period
                {credits.periodEnd ? ` · resets ${formatResetDate(credits.periodEnd)}` : ""}
              </p>
            </div>
          ) : (
            <div>
              <p className="text-4xl font-bold text-foreground">—</p>
              <p className="text-sm text-muted-foreground mt-1">No credit limit configured yet</p>
            </div>
          )}
        </div>

        {/* Stats side cards */}
        <div className="flex flex-col gap-4">
          <div className="flex-1 rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              <Activity className="h-3.5 w-3.5" />
              Used This Period
            </div>
            <p className="text-3xl font-bold text-foreground">{totalUsedThisPeriod}</p>
            <p className="text-xs text-muted-foreground mt-0.5">credits consumed</p>
          </div>
          <div className="flex-1 rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              <Clock className="h-3.5 w-3.5" />
              Last 30 Days
            </div>
            <p className="text-3xl font-bold text-foreground">{history.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              queries · {totalHistoryCredits} credits
            </p>
          </div>
        </div>
      </div>

      {/* Usage history */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Usage History</h2>
          <span className="ml-auto text-xs text-muted-foreground">Last 30 days</span>
        </div>

        {history.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            <Zap className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No AI usage in the last 30 days.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Time</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Event</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Model</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Credits</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {history.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-6 py-3 text-foreground whitespace-nowrap">{formatDate(row.created_at)}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap tabular-nums">{formatTime(row.created_at)}</td>
                    <td className="px-4 py-3 text-foreground whitespace-nowrap">{formatEventType(row.event_type)}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                        {formatModel(row.model)}
                      </code>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <StatusIcon status={row.status} />
                        <span className="text-xs text-muted-foreground capitalize">{row.status ?? "success"}</span>
                      </div>
                    </td>
                    <td className="px-6 py-3 text-right font-semibold tabular-nums text-foreground">
                      {row.credits_deducted ?? 1}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
