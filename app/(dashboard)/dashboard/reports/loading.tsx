export default function ReportsLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-8 w-28 rounded-md bg-muted" />
        <div className="h-4 w-96 rounded-md bg-muted" />
      </div>

      <section className="rounded-xl border border-border bg-card shadow-card">
        <header className="flex flex-col gap-3 px-5 py-4 border-b border-border md:flex-row md:items-center md:justify-between">
          <div className="space-y-1.5">
            <div className="h-5 w-44 rounded-md bg-muted" />
            <div className="h-3 w-56 rounded-md bg-muted" />
          </div>
          <div className="h-9 w-44 rounded-xl bg-muted" />
        </header>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border border-b border-border">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-card px-5 py-3.5 space-y-2">
              <div className="h-3 w-12 rounded bg-muted" />
              <div className="h-6 w-20 rounded bg-muted" />
            </div>
          ))}
        </div>
        <div className="p-5">
          <div className="h-64 rounded-lg bg-muted" />
        </div>
      </section>
    </div>
  )
}
