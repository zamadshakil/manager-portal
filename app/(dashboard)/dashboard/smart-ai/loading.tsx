export default function Loading() {
  return (
    <div aria-hidden="true" className="space-y-6 animate-pulse">
      <div className="h-10 w-64 rounded-md bg-muted" />
      <div className="h-12 rounded-xl bg-muted" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        <div className="lg:col-span-2 h-[480px] rounded-xl border border-border bg-card shadow-card" />
        <div className="space-y-4">
          <div className="h-40 rounded-xl border border-border bg-card shadow-card" />
          <div className="h-40 rounded-xl border border-border bg-card shadow-card" />
        </div>
      </div>
    </div>
  )
}
