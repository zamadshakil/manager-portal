/**
 * Streaming fallback rendered by Next while the dashboard RSC fetches resolve.
 * Mimics the layout of stat cards + table to minimize perceived load.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6 lg:space-y-8 animate-pulse">
      <div className="h-8 w-56 rounded-md bg-muted" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl border border-border bg-card" />
        ))}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 lg:gap-6">
        <div className="xl:col-span-2 space-y-4 lg:space-y-6">
          <div className="h-72 rounded-xl border border-border bg-card" />
          <div className="h-48 rounded-xl border border-border bg-card" />
        </div>
        <div className="space-y-4 lg:space-y-6">
          <div className="h-64 rounded-xl border border-border bg-card" />
          <div className="h-48 rounded-xl border border-border bg-card" />
        </div>
      </div>
    </div>
  )
}
