"use client"
import { useState, useEffect, useMemo } from "react"
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
  ListTodo,
  BrainCircuit,
  MessageSquare,
  CreditCard,
  Search,
  X,
  SlidersHorizontal
} from "lucide-react"
import { formatRelative } from "@/lib/format"
import type { ActivityLogEntry } from "@/lib/types"
import { createClient } from "@/lib/supabase/client"

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
    "smart_ai.query": { label: "asked Smart AI a question", icon: MessageSquare, colorClass: "text-violet-600 bg-violet-100 dark:bg-violet-500/20 dark:text-violet-400" },
    "ai_credits.updated": { label: "updated AI credit limits", icon: CreditCard, colorClass: "text-indigo-600 bg-indigo-100 dark:bg-indigo-500/20 dark:text-indigo-400" },
    "ai_credits.reset": { label: "reset user AI credits", icon: BrainCircuit, colorClass: "text-sky-600 bg-sky-100 dark:bg-sky-500/20 dark:text-sky-400" },
    "ai_credits.bulk_set": { label: "applied bulk AI credit defaults", icon: CreditCard, colorClass: "text-indigo-600 bg-indigo-100 dark:bg-indigo-500/20 dark:text-indigo-400" },
  }
  
  return map[action] ?? { 
    label: action.replace(/[._]/g, " "), 
    icon: AlertCircle, 
    colorClass: "text-slate-600 bg-slate-100 dark:bg-slate-500/20 dark:text-slate-400" 
  }
}

const CATEGORIES = [
  { value: "all",          label: "All" },
  { value: "submission",   label: "Submissions" },
  { value: "announcement", label: "Announcements" },
  { value: "material",     label: "Materials" },
  { value: "rule",         label: "Rules" },
  { value: "user",         label: "Users" },
  { value: "task",         label: "Tasks" },
  { value: "ai",           label: "AI & Credits" },
]

const PERIODS = [
  { value: "all",   label: "All time" },
  { value: "today", label: "Today" },
  { value: "7d",    label: "Last 7 days" },
  { value: "30d",   label: "Last 30 days" },
]

export function ActivityLog({ rows: initialRows, expanded = false }: ActivityLogProps) {
  const [rows, setRows] = useState(initialRows)
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState("all")
  const [period, setPeriod] = useState("all")
  void expanded

  useEffect(() => {
    setRows(initialRows)
  }, [initialRows])

  const filteredRows = useMemo(() => {
    let result = rows

    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(r =>
        (r.actor_name?.toLowerCase().includes(q) ?? false) ||
        (r.actor_email?.toLowerCase().includes(q) ?? false)
      )
    }

    if (category !== "all") {
      if (category === "ai") {
        result = result.filter(r => r.action.startsWith("smart_ai") || r.action.startsWith("ai_credits"))
      } else {
        result = result.filter(r => r.action.startsWith(category))
      }
    }

    if (period !== "all") {
      const now = Date.now()
      const ms = period === "today" ? 86_400_000 : period === "7d" ? 7 * 86_400_000 : 30 * 86_400_000
      result = result.filter(r => now - new Date(r.created_at).getTime() <= ms)
    }

    return result
  }, [rows, search, category, period])

  const hasActiveFilters = search.trim() !== "" || category !== "all" || period !== "all"

  function clearFilters() {
    setSearch("")
    setCategory("all")
    setPeriod("all")
  }

  useEffect(() => {
    const supabase = createClient()
    
    // Subscribe to new activity log entries
    const channel = supabase
      .channel("activity-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "activity_log" },
        async (payload) => {
          const newEntry = payload.new as ActivityLogEntry
          
          // Try to fetch profile info for the actor to make the UI nice
          let actor_name = null
          let actor_email = null
          
          if (newEntry.actor_id) {
            const { data: prof } = await supabase
              .from("profiles")
              .select("full_name, email")
              .eq("id", newEntry.actor_id)
              .maybeSingle()
            
            if (prof) {
              actor_name = prof.full_name
              actor_email = prof.email
            }
          }

          const entryWithActor = {
            ...newEntry,
            actor_name,
            actor_email,
          }

          setRows((prev) => [entryWithActor, ...prev].slice(0, 100))
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [])

  return (
    <section
      aria-labelledby="activity-heading"
      className="rounded-xl border border-border bg-card shadow-card overflow-hidden shrink-0"
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

      {/* Filter bar */}
      <div className="px-5 py-3.5 border-b border-border bg-muted/10 space-y-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search by actor name or email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-8 py-2 text-[13px] rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Category pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          {CATEGORIES.map(c => (
            <button
              key={c.value}
              onClick={() => setCategory(c.value)}
              className={`px-2.5 py-1 rounded-full text-[11.5px] font-medium transition-colors ${
                category === c.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Time period pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <History className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          {PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-2.5 py-1 rounded-full text-[11.5px] font-medium transition-colors ${
                period === p.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Results summary + clear */}
        <div className="flex items-center justify-between pt-0.5">
          <p className="text-[11.5px] text-muted-foreground">
            {filteredRows.length} {filteredRows.length === 1 ? "entry" : "entries"}{hasActiveFilters ? ` of ${rows.length}` : ""}
          </p>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="text-[11.5px] text-primary hover:underline font-medium">
              Clear filters
            </button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-5 text-center">
          <History className="h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-[14px] font-medium text-foreground">No activity recorded</p>
          <p className="text-[13px] text-muted-foreground mt-1">Actions taken by your team will appear here.</p>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-5 text-center">
          <Search className="h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-[14px] font-medium text-foreground">No matching entries</p>
          <p className="text-[13px] text-muted-foreground mt-1">Try adjusting your filters.</p>
          <button onClick={clearFilters} className="mt-3 text-[12.5px] text-primary hover:underline font-medium">Clear filters</button>
        </div>
      ) : (
        <div className="p-5 lg:p-6">
          <div className="relative space-y-6 before:absolute before:top-4 before:bottom-4 before:left-[1.125rem] before:w-px before:bg-border/60">
            {filteredRows.map((entry) => {
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
