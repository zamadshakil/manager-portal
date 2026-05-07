import Link from "next/link"
import { TrendingUp, Activity, ShieldCheck, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"

interface Stat {
  label: string
  value: string
  hint?: string
  icon: React.ComponentType<{ className?: string }>
  tone?: "default" | "warn" | "ok"
  href: string
}

interface StatCardsProps {
  total: number
  passRate: number
  avgScore: number
  needsReview: number
}

export function StatCards({ total, passRate, avgScore, needsReview }: StatCardsProps) {
  const stats: Stat[] = [
    {
      label: "Total submissions",
      value: total.toLocaleString(),
      hint: "all time",
      icon: Activity,
      href: "/dashboard/submissions",
    },
    {
      label: "AI pass rate",
      value: `${passRate}%`,
      hint: "passing validation rules",
      icon: ShieldCheck,
      tone: passRate >= 80 ? "ok" : passRate >= 50 ? "default" : "warn",
      href: "/dashboard/submissions",
    },
    {
      label: "Avg score",
      value: avgScore > 0 ? `${avgScore}/100` : "—",
      hint: "weighted across rules",
      icon: TrendingUp,
      href: "/dashboard/submissions",
    },
    {
      label: "Needs review",
      value: needsReview.toLocaleString(),
      hint: "awaiting attention",
      icon: AlertTriangle,
      tone: needsReview > 0 ? "warn" : "default",
      href: "/dashboard/submissions?status=needs_review",
    },
  ]

  return (
    <section
      aria-label="Key metrics"
      className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4"
    >
      {stats.map((s) => {
        const Icon = s.icon
        return (
          <Link
            key={s.label}
            href={s.href}
            className="rounded-xl border border-border bg-card p-4 lg:p-5 shadow-card transition-all hover:shadow-deep hover:border-primary/30 cursor-pointer block"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                {s.label}
              </p>
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-lg shrink-0",
                  s.tone === "warn" && "bg-[#fff1e6] text-[#a4400a]",
                  s.tone === "ok" && "bg-[#e8f8eb] text-[#157a2a]",
                  (!s.tone || s.tone === "default") && "bg-[#f2f9ff] text-[#097fe8]",
                )}
              >
                <Icon className="h-[14px] w-[14px]" aria-hidden="true" />
              </span>
            </div>
            <p className="mt-3 text-[26px] font-semibold tracking-tight leading-none">
              {s.value}
            </p>
            {s.hint ? (
              <p className="mt-1.5 text-[12px] text-muted-foreground">{s.hint}</p>
            ) : null}
          </Link>
        )
      })}
    </section>
  )
}
