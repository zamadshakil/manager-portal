import { ArrowUpRight, ArrowDownRight, FileCheck2, Sparkles, Clock4, Users } from "lucide-react"
import { cn } from "@/lib/utils"

type Stat = {
  label: string
  value: string
  delta: { value: string; trend: "up" | "down"; positive: boolean }
  icon: React.ComponentType<{ className?: string }>
  hint: string
}

const stats: Stat[] = [
  {
    label: "Submissions today",
    value: "248",
    delta: { value: "+12.4%", trend: "up", positive: true },
    icon: FileCheck2,
    hint: "vs. yesterday",
  },
  {
    label: "AI validation pass-rate",
    value: "94.2%",
    delta: { value: "+2.1pt", trend: "up", positive: true },
    icon: Sparkles,
    hint: "rolling 7 days",
  },
  {
    label: "Avg. analysis latency",
    value: "1.8s",
    delta: { value: "-0.4s", trend: "down", positive: true },
    icon: Clock4,
    hint: "p95 across pipeline",
  },
  {
    label: "Active members",
    value: "62 / 78",
    delta: { value: "-3.1%", trend: "down", positive: false },
    icon: Users,
    hint: "engagement this week",
  },
]

export function StatCards() {
  return (
    <section aria-label="Key metrics" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {stats.map((stat) => {
        const Icon = stat.icon
        const TrendIcon = stat.delta.trend === "up" ? ArrowUpRight : ArrowDownRight
        return (
          <article
            key={stat.label}
            className="rounded-xl border border-border bg-card p-5 shadow-card transition-shadow hover:shadow-deep"
          >
            <div className="flex items-start justify-between">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-warm-white">
                <Icon className="h-[18px] w-[18px] text-foreground" aria-hidden="true" />
              </div>
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  stat.delta.positive
                    ? "bg-[#eafbef] text-[#1aae39]"
                    : "bg-[#fdecdc] text-[#dd5b00]",
                )}
              >
                <TrendIcon className="h-3 w-3" aria-hidden="true" />
                {stat.delta.value}
              </span>
            </div>
            <div className="mt-4">
              <div className="text-[13px] font-medium text-muted-foreground">{stat.label}</div>
              <div className="mt-1 text-[28px] font-bold tracking-[-0.5px] leading-none">
                {stat.value}
              </div>
              <div className="mt-1.5 text-[12px] font-medium text-muted-foreground">
                {stat.hint}
              </div>
            </div>
          </article>
        )
      })}
    </section>
  )
}
