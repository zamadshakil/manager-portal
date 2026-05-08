import {
  Activity,
  AlertTriangle,
  Clock,
  BrainCircuit,
  TrendingDown,
  TrendingUp,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { SystemHealthSummary } from "@/lib/system"

interface HealthStatsProps {
  summary: SystemHealthSummary
}

export function HealthStats({ summary }: HealthStatsProps) {
  const errorRate =
    summary.requests_24h > 0
      ? ((summary.errors_24h / summary.requests_24h) * 100).toFixed(1)
      : "0.0"

  const cards = [
    {
      label: "API Requests (24h)",
      value: summary.requests_24h.toLocaleString(),
      sub: "Total requests",
      icon: Activity,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
    },
    {
      label: "Error Rate (24h)",
      value: `${errorRate}%`,
      sub: `${summary.errors_24h} of ${summary.requests_24h} failed`,
      icon: parseFloat(errorRate) > 5 ? TrendingUp : TrendingDown,
      color: parseFloat(errorRate) > 5 ? "text-red-500" : "text-emerald-500",
      bg: parseFloat(errorRate) > 5 ? "bg-red-500/10" : "bg-emerald-500/10",
    },
    {
      label: "Avg Latency (24h)",
      value:
        summary.avg_latency_ms_24h !== null
          ? summary.avg_latency_ms_24h < 1000
            ? `${summary.avg_latency_ms_24h}ms`
            : `${(summary.avg_latency_ms_24h / 1000).toFixed(2)}s`
          : "—",
      sub: "End-to-end",
      icon: Clock,
      color:
        (summary.avg_latency_ms_24h ?? 0) > 2000 ? "text-amber-500" : "text-violet-500",
      bg:
        (summary.avg_latency_ms_24h ?? 0) > 2000
          ? "bg-amber-500/10"
          : "bg-violet-500/10",
    },
    {
      label: "AI Calls (24h)",
      value: summary.ai_calls_24h.toLocaleString(),
      sub: `${summary.unresolved_errors_24h} unresolved error${summary.unresolved_errors_24h !== 1 ? "s" : ""}`,
      icon: BrainCircuit,
      color: "text-orange-500",
      bg: "bg-orange-500/10",
      badge:
        summary.unresolved_errors_24h > 0 ? (
          <span className="flex items-center gap-1 text-[11px] font-medium text-red-500">
            <AlertTriangle className="h-3 w-3" />
            {summary.unresolved_errors_24h} unresolved
          </span>
        ) : null,
    },
  ]

  return (
    <section
      className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4"
      aria-label="System health overview"
    >
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <div
            key={card.label}
            className="rounded-xl border border-border bg-card p-4 lg:p-5 shadow-card"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-muted-foreground truncate">
                  {card.label}
                </p>
                <p className="mt-1.5 text-[24px] font-semibold tracking-tight leading-none">
                  {card.value}
                </p>
                {card.badge ? (
                  <div className="mt-1.5">{card.badge}</div>
                ) : (
                  <p className="mt-1.5 text-[12px] text-muted-foreground">{card.sub}</p>
                )}
              </div>
              <div className={cn("rounded-lg p-2 shrink-0", card.bg)}>
                <Icon className={cn("h-4 w-4", card.color)} />
              </div>
            </div>
          </div>
        )
      })}
    </section>
  )
}
