import { cn } from "@/lib/utils"
import type { SubmissionStatus, TaskAssignmentStatus } from "@/lib/types"

type AnyStatus = SubmissionStatus | TaskAssignmentStatus | string

const styles: Record<string, { label: string; cls: string }> = {
  // Submission states
  queued: { label: "Queued", cls: "bg-muted text-muted-foreground" },
  parsing: { label: "Parsing", cls: "bg-[#f2f9ff] text-[#097fe8]" },
  validating: { label: "Validating", cls: "bg-[#f2f9ff] text-[#097fe8]" },
  passed: { label: "Passed", cls: "bg-[#e8f8eb] text-[#157a2a]" },
  failed: { label: "Failed", cls: "bg-[#fff1e6] text-[#a4400a]" },
  needs_review: { label: "Needs review", cls: "bg-[#fff8e1] text-[#7a5b00]" },
  late_submitted: { label: "Late", cls: "bg-[#fff8e1] text-[#7a5b00]" },
  missed: { label: "Missed", cls: "bg-[#fff1e6] text-[#a4400a]" },
  // Task assignment states
  assigned: { label: "Assigned", cls: "bg-muted text-muted-foreground" },
  submitted: { label: "Submitted", cls: "bg-[#e8f8eb] text-[#157a2a]" },
  pending: { label: "Not Started", cls: "bg-[#fff8e1] text-[#7a5b00]" },
}

export function StatusBadge({
  status,
  className,
}: {
  status: AnyStatus
  className?: string
}) {
  const s = styles[status] ?? { label: String(status), cls: "bg-muted text-muted-foreground" }
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
