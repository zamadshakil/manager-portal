import { 
  History, 
  FileText, 
  RefreshCw, 
  Trash2, 
  Megaphone, 
  FolderPlus, 
  ShieldCheck, 
  Pencil, 
  UserPlus,
  CheckCircle2,
  AlertCircle,
  ListTodo
} from "lucide-react"
import { formatRelative } from "@/lib/format"
import type { ActivityLogEntry } from "@/lib/types"

interface ActivityLogProps {
  rows: (ActivityLogEntry & { actor_email?: string | null; actor_name?: string | null })[]
  expanded?: boolean
}

function getActionDetails(action: string) {
  const map: Record<string, { label: string, icon: any, colorClass: string }> = {
    "submission.created": { label: "uploaded a submission", icon: FileText, colorClass: "text-blue-600 bg-blue-100 dark:bg-blue-500/20 dark:text-blue-400" },
    "submission.retried": { label: "retried validation", icon: RefreshCw, colorClass: "text-amber-600 bg-amber-100 dark:bg-amber-500/20 dark:text-amber-400" },
    "submission.deleted": { label: "deleted a submission", icon: Trash2, colorClass: "text-red-600 bg-red-100 dark:bg-red-500/20 dark:text-red-400" },
    "submission.bulk_deleted": { label: "bulk deleted submissions", icon: Trash2, colorClass: "text-red-600 bg-red-100 dark:bg-red-500/20 dark:text-red-400" },
    "announcement.created": { label: "posted an announcement", icon: Megaphone, colorClass: "text-emerald-600 bg-emerald-100 dark:bg-emerald-500/20 dark:text-emerald-400" },
    "announcement.deleted": { label: "removed an announcement", icon: Trash2, colorClass: "text-red-600 bg-red-100 dark:bg-red-500/20 dark:text-red-400" },
    "material.created": { label: "shared a material", icon: FolderPlus, colorClass: "text-indigo-600 bg-indigo-100 dark:bg-indigo-500/20 dark:text-indigo-400" },
    "material.deleted": { label: "removed a material", icon: Trash2, colorClass: "text-red-600 bg-red-100 dark:bg-red-500/20 dark:text-red-400" },
    "rule.created": { label: "added a validation rule", icon: ShieldCheck, colorClass: "text-emerald-600 bg-emerald-100 dark:bg-emerald-500/20 dark:text-emerald-400" },
    "rule.updated": { label: "updated a validation rule", icon: Pencil, colorClass: "text-blue-600 bg-blue-100 dark:bg-blue-500/20 dark:text-blue-400" },
    "rule.deleted": { label: "removed a validation rule", icon: Trash2, colorClass: "text-red-600 bg-red-100 dark:bg-red-500/20 dark:text-red-400" },
    "user.provisioned": { label: "provisioned a user", icon: UserPlus, colorClass: "text-purple-600 bg-purple-100 dark:bg-purple-500/20 dark:text-purple-400" },
    "task.created": { label: "created a new task", icon: ListTodo, colorClass: "text-emerald-600 bg-emerald-100 dark:bg-emerald-500/20 dark:text-emerald-400" },
    "task.deleted": { label: "deleted a task", icon: Trash2, colorClass: "text-red-600 bg-red-100 dark:bg-red-500/20 dark:text-red-400" },
  }
  
  return map[action] ?? { 
    label: action.replace(/[._]/g, " "), 
    icon: AlertCircle, 
    colorClass: "text-slate-600 bg-slate-100 dark:bg-slate-500/20 dark:text-slate-400" 
  }
}

export function ActivityLog({ rows, expanded = false }: ActivityLogProps) {
  void expanded
  return (
    <section
      aria-labelledby="activity-heading"
      className="rounded-xl border border-border bg-card shadow-card overflow-hidden"
    >
      <header className="flex items-center gap-3 border-b border-border bg-muted/30 px-5 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <History className="h-4.5 w-4.5" aria-hidden="true" />
        </span>
        <div>
          <h2 id="activity-heading" className="text-[16px] font-semibold tracking-tight text-foreground">
            Workspace Activity
          </h2>
          <p className="text-[12.5px] text-muted-foreground mt-0.5">Immutable audit trail of system operations.</p>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-5 text-center">
          <History className="h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-[14px] font-medium text-foreground">No activity recorded</p>
          <p className="text-[13px] text-muted-foreground mt-1">Actions taken by your team will appear here.</p>
        </div>
      ) : (
        <div className="p-5 lg:p-6">
          <div className="relative space-y-6 before:absolute before:top-4 before:bottom-4 before:left-[1.125rem] before:w-px before:bg-border/60">
            {rows.map((entry) => {
              const details = getActionDetails(entry.action)
              const Icon = details.icon
              
              return (
                <div key={entry.id} className="relative flex items-start gap-4 group">
                  {/* Icon Marker */}
                  <div className={`relative z-10 flex items-center justify-center w-9 h-9 shrink-0 rounded-full border-[3px] border-card shadow-sm ${details.colorClass}`}>
                    <Icon className="h-[15px] w-[15px]" />
                  </div>
                  
                  {/* Content Card */}
                  <div className="flex-1 min-w-0 rounded-xl border border-border/60 bg-muted/10 p-3.5 shadow-sm transition-all hover:border-border hover:bg-muted/30">
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 mb-1.5">
                      <p className="text-[13.5px] leading-snug">
                        <strong className="font-semibold text-foreground">
                          {entry.actor_name ?? entry.actor_email ?? "System"}
                        </strong>{" "}
                        <span className="text-foreground/80">{details.label}</span>
                      </p>
                      <time className="text-[11.5px] font-medium text-muted-foreground whitespace-nowrap">
                        {formatRelative(entry.created_at)}
                      </time>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[9.5px] font-bold uppercase tracking-wider bg-background border border-border text-muted-foreground">
                        {entry.entity_type}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
