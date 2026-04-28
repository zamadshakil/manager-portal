import { ArrowRight, TrendingUp, TrendingDown, Minus } from "lucide-react"
import { cn } from "@/lib/utils"

type Member = {
  name: string
  role: string
  avatar: string
  submissions: number
  passRate: number
  trend: "up" | "down" | "flat"
}

const members: Member[] = [
  { name: "Maya Chen", role: "Compliance lead", avatar: "MC", submissions: 28, passRate: 96, trend: "up" },
  { name: "Priya Shah", role: "People Ops", avatar: "PS", submissions: 22, passRate: 94, trend: "up" },
  { name: "Ravi Kapoor", role: "Engineering", avatar: "RK", submissions: 19, passRate: 88, trend: "flat" },
  { name: "Daniel Reyes", role: "Field Ops", avatar: "DR", submissions: 17, passRate: 76, trend: "down" },
  { name: "Lina Osei", role: "Customer Success", avatar: "LO", submissions: 14, passRate: 90, trend: "up" },
]

const trendIcon = { up: TrendingUp, down: TrendingDown, flat: Minus }
const trendColor = {
  up: "text-[#1aae39]",
  down: "text-[#dd5b00]",
  flat: "text-muted-foreground",
}

export function TeamPerformance() {
  return (
    <section
      id="team"
      aria-labelledby="team-heading"
      className="rounded-xl border border-border bg-card shadow-card"
    >
      <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
        <div>
          <h2 id="team-heading" className="text-[16px] font-bold tracking-[-0.25px]">
            Team performance
          </h2>
          <p className="text-[12px] font-medium text-muted-foreground">
            Individual submission scores this week
          </p>
        </div>
        <a
          href="#all-team"
          className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline"
        >
          All members
          <ArrowRight className="h-3.5 w-3.5" />
        </a>
      </header>

      <ul className="divide-y divide-border">
        {members.map((m) => {
          const TrendIcon = trendIcon[m.trend]
          return (
            <li
              key={m.name}
              className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/40"
            >
              <div className="h-9 w-9 shrink-0 rounded-lg bg-warm-white flex items-center justify-center text-[12px] font-semibold">
                {m.avatar}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold tracking-[-0.125px] truncate">
                  {m.name}
                </div>
                <div className="text-[11.5px] font-medium text-muted-foreground truncate">
                  {m.role}
                </div>
              </div>
              <div className="hidden sm:block w-32">
                <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground mb-1">
                  <span>Pass rate</span>
                  <span className="text-foreground tabular-nums">{m.passRate}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      m.passRate >= 90
                        ? "bg-[#1aae39]"
                        : m.passRate >= 80
                        ? "bg-[#0075de]"
                        : "bg-[#dd5b00]",
                    )}
                    style={{ width: `${m.passRate}%` }}
                  />
                </div>
              </div>
              <div className="text-right">
                <div className="text-[13px] font-semibold tabular-nums">{m.submissions}</div>
                <div className={cn("inline-flex items-center gap-0.5 text-[11px] font-semibold", trendColor[m.trend])}>
                  <TrendIcon className="h-3 w-3" aria-hidden="true" />
                  <span className="capitalize">{m.trend === "flat" ? "Stable" : m.trend}</span>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
