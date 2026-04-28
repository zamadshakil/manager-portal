import { Sparkles, TrendingDown, TriangleAlert, Lightbulb, ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"

type Insight = {
  id: string
  kind: "predictive" | "warning" | "tip"
  title: string
  body: string
  meta?: string
}

const insights: Insight[] = [
  {
    id: "i1",
    kind: "predictive",
    title: "Field Ops trending toward late submissions",
    body: "Predictive model flags a 71% probability that 4 members miss the Friday deadline based on submission cadence.",
    meta: "Confidence 71% · 4 members",
  },
  {
    id: "i2",
    kind: "warning",
    title: "Vendor Risk template often missing SLA matrix",
    body: "9 of the last 14 submissions in this template failed validation on the same field. Consider auto-prompting.",
    meta: "Recurring · 9/14 docs",
  },
  {
    id: "i3",
    kind: "tip",
    title: "Compliance team scoring above 95 average",
    body: "Highlight Maya Chen and Priya Shah's submissions as templates for other teams in this week's all-hands.",
    meta: "Avg. score 95.4",
  },
]

const styles: Record<
  Insight["kind"],
  { icon: React.ComponentType<{ className?: string }>; tag: string; tagCls: string }
> = {
  predictive: {
    icon: TrendingDown,
    tag: "Predictive",
    tagCls: "bg-[#f2f9ff] text-[#097fe8]",
  },
  warning: {
    icon: TriangleAlert,
    tag: "Pattern",
    tagCls: "bg-[#fef8e1] text-[#a86b00]",
  },
  tip: {
    icon: Lightbulb,
    tag: "Suggestion",
    tagCls: "bg-[#eafbef] text-[#1aae39]",
  },
}

export function AIInsights() {
  return (
    <section
      id="insights"
      aria-labelledby="insights-heading"
      className="rounded-xl border border-border bg-card shadow-card"
    >
      <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f2f9ff] text-[#097fe8] shrink-0">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 id="insights-heading" className="text-[16px] font-bold tracking-[-0.25px]">
              AI Insights
            </h2>
            <p className="text-[12px] font-medium text-muted-foreground">
              Predictive flags from the LLM analysis pipeline
            </p>
          </div>
        </div>
        <span className="hidden sm:inline-flex items-center rounded-full bg-warm-white px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
          Updated 2m ago
        </span>
      </header>

      <ul className="divide-y divide-border">
        {insights.map((i) => {
          const Icon = styles[i.kind].icon
          return (
            <li key={i.id} className="px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warm-white">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-[0.125px]",
                        styles[i.kind].tagCls,
                      )}
                    >
                      {styles[i.kind].tag}
                    </span>
                    {i.meta && (
                      <span className="text-[11px] font-medium text-muted-foreground">
                        {i.meta}
                      </span>
                    )}
                  </div>
                  <h3 className="mt-1.5 text-[14px] font-semibold leading-snug tracking-[-0.125px]">
                    {i.title}
                  </h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{i.body}</p>
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      <footer className="border-t border-border px-5 py-3">
        <a
          href="#all-insights"
          className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline"
        >
          Open insights workspace
          <ArrowRight className="h-3.5 w-3.5" />
        </a>
      </footer>
    </section>
  )
}
