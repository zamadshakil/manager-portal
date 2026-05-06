import { Megaphone, Clock, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatRelative, formatDate } from "@/lib/format"
import { DeleteIconButton } from "@/components/dashboard/delete-icon-button"
import { deleteAnnouncement } from "@/app/actions/announcements"
import type { Announcement, AnnouncementPriority } from "@/lib/types"

const priorityStyle: Record<AnnouncementPriority, string> = {
  low: "bg-muted text-muted-foreground",
  normal: "bg-[#f2f9ff] text-[#097fe8]",
  high: "bg-[#fff8e1] text-[#7a5b00]",
  urgent: "bg-[#fff1e6] text-[#a4400a]",
}

interface AnnouncementsProps {
  rows: Announcement[]
  emptyHint?: string
  canDelete?: boolean
  showAll?: boolean
}

export function Announcements({ rows, emptyHint, canDelete = false }: AnnouncementsProps) {
  return (
    <section
      aria-labelledby="announcements-heading"
      className="rounded-xl border border-border bg-card shadow-card"
    >
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 lg:px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-warm-white">
          <Megaphone className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id="announcements-heading" className="text-[15px] font-semibold tracking-tight">
            Announcements
          </h2>
          <p className="text-[12px] text-muted-foreground">Updates from administrators and managers.</p>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-[13px] font-semibold">No announcements yet</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {emptyHint ?? "Your administrator will post important updates here."}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((a) => (
            <li key={a.id} className="px-4 py-4 lg:px-5">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize",
                    priorityStyle[a.priority],
                  )}
                >
                  {a.priority}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                  <Users className="h-3 w-3" />
                  {a.teams?.name ?? "Global"}
                </span>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {formatRelative(a.created_at)}
                </span>
                {canDelete ? (
                  <DeleteIconButton
                    id={a.id}
                    action={deleteAnnouncement}
                    confirmText="Delete this announcement?"
                    label="Delete announcement"
                  />
                ) : null}
              </div>
              <h3 className="mt-2 text-[14px] font-semibold leading-snug">{a.title}</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground whitespace-pre-line">
                {a.body}
              </p>
              {a.expires_at ? (
                <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-medium text-destructive/90">
                  <Clock className="h-3.5 w-3.5" />
                  <span>Expires {formatDate(a.expires_at)}</span>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
