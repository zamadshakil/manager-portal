export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || n < 0) return "—"
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function formatRelative(iso: string | Date | null | undefined): string {
  if (!iso) return "—"
  const date = typeof iso === "string" ? new Date(iso) : iso
  const diff = Date.now() - date.getTime()
  const sec = Math.round(diff / 1000)
  if (sec < 5) return "just now"
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function formatRelativeDeadline(iso: string | Date | null | undefined): string {
  if (!iso) return "—"
  const date = typeof iso === "string" ? new Date(iso) : iso
  const diff = date.getTime() - Date.now()
  const future = diff >= 0
  const absDiff = Math.abs(diff)
  const sec = Math.round(absDiff / 1000)
  if (sec < 5) return future ? "in moments" : "just now"
  if (sec < 60) return future ? `in ${sec}s` : `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return future ? `in ${min}m` : `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return future ? `in ${hr}h` : `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return future ? `in ${day}d` : `${day}d ago`
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
 }

/**
 * Format a deadline timestamp as "May 15, 2026 · 5:00 PM (in 2 days)" or
 * "May 10, 2026 · 5:00 PM (3h ago)". Combines an absolute date+time with a
 * human-readable relative offset so members see both precision and urgency.
 *
 * Locale is pinned to `en-US` so the string is byte-identical between the
 * Node SSR render (Railway container locale) and the browser hydration pass
 * (the viewer's navigator locale) — otherwise React throws hydration error
 * #418 on any non-English viewer.
 *
 * `now` defaults to `Date.now()` for legacy callers, but Client Components
 * that render this text inside an SSR'd tree MUST pass a stable `initialNow`
 * that was computed once on the server and threaded down — otherwise the
 * `(in 2h)` suffix will drift between the two passes and trip hydration.
 */
export function formatDeadline(
  iso: string | Date | null | undefined,
  now: number = Date.now(),
): string {
  if (!iso) return "—"
  const date = typeof iso === "string" ? new Date(iso) : iso
  const absDate = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  const absTime = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  })
  const diff = date.getTime() - now
  const future = diff > 0
  const absDiff = Math.abs(diff)
  const sec = Math.round(absDiff / 1000)
  const min = Math.floor(sec / 60)
  const hr = Math.floor(min / 60)
  const day = Math.floor(hr / 24)
  let rel: string
  if (sec < 60) rel = future ? "in <1m" : "just now"
  else if (min < 60) rel = future ? `in ${min}m` : `${min}m ago`
  else if (hr < 24) rel = future ? `in ${hr}h` : `${hr}h ago`
  else rel = future ? `in ${day}d` : `${day}d ago`
  return `${absDate} · ${absTime} (${rel})`
}

export function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—"
  const date = typeof iso === "string" ? new Date(iso) : iso
  return date.toLocaleDateString(undefined, { 
    month: "short", 
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  })
}

export function fileIconLabel(mime: string | null | undefined): string {
  if (!mime) return "FILE"
  if (mime.includes("pdf")) return "PDF"
  if (mime.includes("word") || mime.includes("document")) return "DOC"
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "PPT"
  if (mime.includes("spreadsheet") || mime.includes("excel")) return "XLS"
  if (mime.startsWith("image/")) return "IMG"
  if (mime.startsWith("text/")) return "TXT"
  return "FILE"
}
