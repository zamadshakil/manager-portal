/**
 * Per-segment streaming fallback for /dashboard/tasks. Rendered immediately
 * while the page's data fetches resolve so the user never sees a blank
 * <main> during navigation. Mirrors the actual page layout (header,
 * composer card, list rows) to minimize perceived load.
 */
export default function TasksLoading() {
  return (
    <div className="space-y-6 lg:space-y-8 animate-pulse">
      <div className="space-y-2">
        <div className="h-8 w-32 rounded-md bg-muted" />
        <div className="h-4 w-80 rounded-md bg-muted" />
      </div>

      <div className="rounded-xl border border-border bg-card shadow-card p-5 space-y-4">
        <div className="h-5 w-40 rounded-md bg-muted" />
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="h-10 rounded-lg bg-muted" />
          <div className="h-10 rounded-lg bg-muted" />
        </div>
        <div className="h-24 rounded-lg bg-muted" />
        <div className="flex justify-end">
          <div className="h-9 w-28 rounded-xl bg-muted" />
        </div>
      </div>

      <div className="space-y-3">
        <div className="h-4 w-24 rounded-md bg-muted" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl border border-border bg-card" />
        ))}
      </div>
    </div>
  )
}
