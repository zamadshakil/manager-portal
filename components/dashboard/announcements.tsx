import { Megaphone, Pin, ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"

type Announcement = {
  id: string
  badge: { label: string; tone: "blue" | "green" | "orange" }
  title: string
  body: string
  author: { name: string; role: string }
  timestamp: string
  pinned?: boolean
}

const announcements: Announcement[] = [
  {
    id: "a1",
    badge: { label: "System", tone: "blue" },
    title: "Q2 submission cycle opens Monday",
    body: "All teams should prepare quarterly compliance documents. The LLM validator has been updated with new policy checks for ISO 27001 alignment.",
    author: { name: "Olivia Park", role: "Main Admin" },
    timestamp: "2h ago",
    pinned: true,
  },
  {
    id: "a2",
    badge: { label: "Update", tone: "green" },
    title: "AI summary length increased to 1200 tokens",
    body: "Manager dashboards now display richer summaries. No action required from team members — historical submissions remain unchanged.",
    author: { name: "Olivia Park", role: "Main Admin" },
    timestamp: "Yesterday",
  },
  {
    id: "a3",
    badge: { label: "Reminder", tone: "orange" },
    title: "Resubmit field reports flagged by validator",
    body: "12 submissions from the field operations group need formatting fixes. See the AI Insights panel for individualized feedback.",
    author: { name: "Alex Morgan", role: "Manager" },
    timestamp: "2d ago",
  },
]

const toneStyles: Record<Announcement["badge"]["tone"], string> = {
  blue: "bg-[#f2f9ff] text-[#097fe8]",
  green: "bg-[#eafbef] text-[#1aae39]",
  orange: "bg-[#fdecdc] text-[#dd5b00]",
}

export function Announcements() {
  return (
    <section
      id="announcements"
      aria-labelledby="announcements-heading"
      className="rounded-xl border border-border bg-card shadow-card"
    >
      <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-warm-white shrink-0">
            <Megaphone className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2
              id="announcements-heading"
              className="text-[16px] font-bold tracking-[-0.25px] truncate"
            >
              Announcements
            </h2>
            <p className="text-[12px] font-medium text-muted-foreground">
              Real-time updates from admins and managers
            </p>
          </div>
        </div>
        <a
          href="#all-announcements"
          className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline"
        >
          View all
          <ArrowRight className="h-3.5 w-3.5" />
        </a>
      </header>

      <ul className="divide-y divide-border">
        {announcements.map((a) => (
          <li key={a.id} className="px-5 py-4 transition-colors hover:bg-muted/40">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-[0.125px]",
                  toneStyles[a.badge.tone],
                )}
              >
                {a.badge.label}
              </span>
              {a.pinned && (
                <span className="inline-flex items-center gap-1 rounded-full bg-warm-white px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                  <Pin className="h-3 w-3" />
                  Pinned
                </span>
              )}
              <span className="ml-auto text-[12px] font-medium text-muted-foreground">
                {a.timestamp}
              </span>
            </div>
            <h3 className="mt-2 text-[15px] font-semibold leading-snug tracking-[-0.125px]">
              {a.title}
            </h3>
            <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">{a.body}</p>
            <div className="mt-2.5 flex items-center gap-2 text-[12px]">
              <div className="h-5 w-5 rounded-full bg-warm-white flex items-center justify-center text-[10px] font-semibold">
                {a.author.name
                  .split(" ")
                  .map((p) => p[0])
                  .join("")}
              </div>
              <span className="font-semibold text-foreground">{a.author.name}</span>
              <span className="text-muted-foreground">— {a.author.role}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
