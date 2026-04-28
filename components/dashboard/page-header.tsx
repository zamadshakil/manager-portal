import { Sparkles, ChevronRight } from "lucide-react"

export function PageHeader() {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[12px] font-medium text-muted-foreground">
          <span>Workspace</span>
          <ChevronRight className="h-3 w-3" />
          <span>North District Team</span>
          <ChevronRight className="h-3 w-3" />
          <span className="text-foreground">Overview</span>
        </nav>
        <h1
          id="overview"
          className="mt-1.5 text-[28px] sm:text-[32px] font-bold leading-[1.05] tracking-[-1px] text-balance"
        >
          Good morning, Alex.
        </h1>
        <p className="mt-1.5 text-[14.5px] text-muted-foreground leading-relaxed max-w-2xl text-pretty">
          Here&apos;s what&apos;s happening across your team today. The LLM pipeline has
          processed{" "}
          <span className="font-semibold text-foreground">248 submissions</span> with a{" "}
          <span className="font-semibold text-foreground">94.2% pass rate</span>.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f2f9ff] px-3 py-1.5 text-[12px] font-semibold tracking-[0.125px] text-[#097fe8]">
          <Sparkles className="h-3.5 w-3.5" />
          AI pipeline operational
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-warm-white px-3 py-1.5 text-[12px] font-semibold tracking-[0.125px] text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-[#1aae39]" />
          All systems normal
        </span>
      </div>
    </div>
  )
}
