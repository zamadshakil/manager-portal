import Link from "next/link"
import { ArrowLeft, ListChecks } from "lucide-react"

export default function TaskNotFound() {
  return (
    <div className="space-y-6 lg:space-y-8">
      <Link
        href="/dashboard/tasks"
        className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Back to tasks
      </Link>

      <section className="rounded-xl border border-border bg-card shadow-card">
        <div className="flex flex-col items-center px-6 py-12 text-center sm:px-8">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <ListChecks className="h-5 w-5" aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-[20px] font-semibold tracking-tight">Task not found</h1>
          <p className="mt-2 max-w-md text-[13px] text-muted-foreground">
            This task may have been deleted, moved, or you may no longer have access to it.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/dashboard/tasks"
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-[12.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Open tasks
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex h-9 items-center justify-center rounded-md border border-border px-4 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-muted"
            >
              Go to dashboard
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
