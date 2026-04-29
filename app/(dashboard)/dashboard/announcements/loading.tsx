export default function AnnouncementsLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-8 w-44 rounded-md bg-muted" />
        <div className="h-4 w-80 rounded-md bg-muted" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl border border-border bg-card" />
          ))}
        </div>
        <div className="rounded-xl border border-border bg-card shadow-card h-72" />
      </div>
    </div>
  )
}
