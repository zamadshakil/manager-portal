"use client"

import useSWR from "swr"
import { Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AiCreditPeriod } from "@/lib/types"

interface CreditStatus {
  used: number
  limit: number
  remaining: number
  periodType: AiCreditPeriod
  periodEnd: string | null
  isUnlimited: boolean
  hasLimit: boolean
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function CreditsBadge() {
  const { data, isLoading } = useSWR<CreditStatus>("/api/ai-credits/me", fetcher, {
    refreshInterval: 60_000, // refresh every 60s
    revalidateOnFocus: true,
  })

  if (isLoading || !data) return null

  if (data.isUnlimited) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 dark:text-indigo-400">
        <Zap className="h-3 w-3 shrink-0" />
        <span className="text-[10px] font-semibold whitespace-nowrap">Unlimited</span>
      </div>
    )
  }

  if (!data.hasLimit) {
    return null
  }

  const pct = data.limit > 0 ? (data.remaining / data.limit) * 100 : 0
  const colorClass =
    pct <= 10
      ? "bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400"
      : pct <= 50
      ? "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400"
      : "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"

  const pulseClass = pct <= 10 ? "animate-pulse" : ""

  const resetLabel = data.periodEnd
    ? `resets ${new Date(data.periodEnd + "T00:00:00").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })}`
    : data.periodType

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-semibold whitespace-nowrap",
        colorClass,
        pulseClass,
      )}
      title={`${data.remaining} of ${data.limit} AI credits remaining this ${data.periodType} period`}
    >
      <Zap className="h-3 w-3 shrink-0" />
      <span>
        {data.remaining.toLocaleString()} / {data.limit.toLocaleString()} · {resetLabel}
      </span>
    </div>
  )
}
