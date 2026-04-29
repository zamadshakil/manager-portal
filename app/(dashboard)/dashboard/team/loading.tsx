export default function TeamLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-8 w-56 rounded-md bg-muted" />
        <div className="h-4 w-96 rounded-md bg-muted" />
      </div>

      <div className="h-10 w-56 rounded-xl bg-muted" />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] items-start">
        <div className="space-y-3 min-w-0">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl border border-border bg-card" />
          ))}
        </div>
        <div className="rounded-xl border border-border bg-card shadow-card h-[480px]" />
      </div>
    </div>
  )
}
