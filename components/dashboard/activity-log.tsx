import {
  LogIn,
  Upload,
  Trash2,
  KeyRound,
  ShieldCheck,
  FileSignature,
} from "lucide-react"
import { cn } from "@/lib/utils"

type Activity = {
  id: string
  actor: string
  action: string
  target: string
  time: string
  kind: "login" | "upload" | "delete" | "credential" | "permission" | "approve"
}

const activities: Activity[] = [
  {
    id: "l1",
    actor: "Maya Chen",
    action: "uploaded",
    target: "Q2 Compliance Report — North District.pdf",
    time: "2 min ago",
    kind: "upload",
  },
  {
    id: "l2",
    actor: "Alex Morgan",
    action: "approved",
    target: "Onboarding Deck — Cohort 12",
    time: "12 min ago",
    kind: "approve",
  },
  {
    id: "l3",
    actor: "Olivia Park",
    action: "rotated credentials for",
    target: "Field Ops · 4 members",
    time: "1 hr ago",
    kind: "credential",
  },
  {
    id: "l4",
    actor: "Daniel Reyes",
    action: "signed in from",
    target: "Chrome · macOS · Berlin",
    time: "1 hr ago",
    kind: "login",
  },
  {
    id: "l5",
    actor: "Jordan Wells",
    action: "deleted",
    target: "Vendor Risk Assessment v2.docx",
    time: "Yesterday",
    kind: "delete",
  },
  {
    id: "l6",
    actor: "Alex Morgan",
    action: "updated permissions for",
    target: "Procurement team",
    time: "Yesterday",
    kind: "permission",
  },
]

const iconMap: Record<Activity["kind"], React.ComponentType<{ className?: string }>> = {
  login: LogIn,
  upload: Upload,
  delete: Trash2,
  credential: KeyRound,
  permission: ShieldCheck,
  approve: FileSignature,
}

const colorMap: Record<Activity["kind"], string> = {
  login: "bg-warm-white text-foreground",
  upload: "bg-[#f2f9ff] text-[#097fe8]",
  delete: "bg-[#fdecdc] text-[#dd5b00]",
  credential: "bg-[#fef8e1] text-[#a86b00]",
  permission: "bg-[#f3eaff] text-[#6e3bb5]",
  approve: "bg-[#eafbef] text-[#1aae39]",
}

export function ActivityLog() {
  return (
    <section
      id="activity"
      aria-labelledby="activity-heading"
      className="rounded-xl border border-border bg-card shadow-card"
    >
      <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
        <div>
          <h2 id="activity-heading" className="text-[16px] font-bold tracking-[-0.25px]">
            Activity log
          </h2>
          <p className="text-[12px] font-medium text-muted-foreground">
            Immutable audit trail of every action
          </p>
        </div>
        <a
          href="#full-log"
          className="text-[13px] font-semibold text-primary hover:underline"
        >
          Export
        </a>
      </header>

      <ol className="px-5 py-4 space-y-4">
        {activities.map((a, idx) => {
          const Icon = iconMap[a.kind]
          const isLast = idx === activities.length - 1
          return (
            <li key={a.id} className="relative pl-9">
              {!isLast && (
                <span
                  aria-hidden="true"
                  className="absolute left-3.5 top-7 bottom-[-16px] w-px bg-border"
                />
              )}
              <span
                className={cn(
                  "absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full",
                  colorMap[a.kind],
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <p className="text-[13.5px] leading-snug">
                <span className="font-semibold">{a.actor}</span>{" "}
                <span className="text-muted-foreground">{a.action}</span>{" "}
                <span className="font-medium">{a.target}</span>
              </p>
              <p className="text-[11.5px] font-medium text-muted-foreground mt-0.5">{a.time}</p>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
