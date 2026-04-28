import { cn } from "@/lib/utils"
import type { SubmissionStatus } from "@/lib/types"

const styles: Record<SubmissionStatus, { label: string; cls: string }> = {
  queued: { label: "Queued", cls: "bg-muted text-muted-foreground" },
  parsing: { label: "Parsing", cls: "bg-[#f2f9ff] text-[#097fe8]" },
  validating: { label: "Validating", cls: "bg-[#f2f9ff] text-[#097fe8]" },
  passed: { label: "Passed", cls: "bg-[#e8f8eb] text-[#157a2a]" },
  failed: { label: "Failed", cls: "bg-[#fff1e6] text-[#a4400a]" },
  needs_review: { label: "Needs review", cls: "bg-[#fff8e1] text-[#7a5b00]" },
}

export function StatusBadge({ status, className }: { status: SubmissionStatus; className?: string }) {
  const s = styles[status]
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none whitespace-nowrap",
        s.cls,
        className,
      )}
    >
      {s.label}
    </span>
  )
}
