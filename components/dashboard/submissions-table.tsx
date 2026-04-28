import Link from "next/link"
import { ArrowRight, FileText } from "lucide-react"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { fileIconLabel, formatBytes, formatRelative } from "@/lib/format"
import type { Submission } from "@/lib/types"

interface SubmissionsTableProps {
  rows: Submission[]
  showFooterLink?: boolean
  emptyHint?: string
}

export function SubmissionsTable({ rows, showFooterLink = true, emptyHint }: SubmissionsTableProps) {
  return (
    <section
      aria-labelledby="submissions-heading"
      className="rounded-xl border border-border bg-card shadow-card"
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3.5 lg:px-5">
        <div>
          <h2 id="submissions-heading" className="text-[15px] font-semibold tracking-tight">
            Recent submissions
          </h2>
          <p className="text-[12px] text-muted-foreground">
            Live LLM validation pipeline output.
          </p>
        </div>
        {showFooterLink ? (
          <Link
            href="/dashboard/submissions"
            className="text-[13px] font-semibold text-primary hover:underline"
          >
            View all
          </Link>
        ) : null}
      </header>

      {rows.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 text-[14px] font-semibold">No submissions yet</p>
          <p className="text-[12px] text-muted-foreground mt-1">
            {emptyHint ?? "Upload a document to begin AI validation."}
          </p>
        </div>
      ) : (
        <>
          {/* Mobile: card list */}
          <ul className="md:hidden divide-y divide-border">
            {rows.map((row) => (
              <li key={row.id} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warm-white text-[10.5px] font-semibold tracking-wide">
                    {fileIconLabel(row.mime_type)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/dashboard/submissions/${row.id}`}
                      className="block text-[13px] font-semibold truncate hover:text-primary"
                    >
                      {row.title}
                    </Link>
                    <p className="text-[11px] text-muted-foreground">
                      {formatBytes(row.size_bytes)} · {formatRelative(row.created_at)}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <StatusBadge status={row.status} />
                      {row.score !== null ? (
                        <span className="text-[11px] font-semibold text-muted-foreground">
                          {Number(row.score).toFixed(0)}/100
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <div className="hidden md:block">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-[0.04em] text-muted-foreground">
                  <th className="px-5 py-2.5 font-semibold">Submission</th>
                  <th className="px-5 py-2.5 font-semibold">Status</th>
                  <th className="px-5 py-2.5 font-semibold">Score</th>
                  <th className="px-5 py-2.5 font-semibold">Size</th>
                  <th className="px-5 py-2.5 font-semibold">Uploaded</th>
                  <th className="px-5 py-2.5 font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-[13px]">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/40 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-warm-white text-[10.5px] font-semibold tracking-wide">
                          {fileIconLabel(row.mime_type)}
                        </span>
                        <Link
                          href={`/dashboard/submissions/${row.id}`}
                          className="block truncate font-semibold hover:text-primary"
                        >
                          {row.title}
                        </Link>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-5 py-3 font-mono text-[12px]">
                      {row.score !== null ? `${Number(row.score).toFixed(0)}/100` : "—"}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {formatBytes(row.size_bytes)}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {formatRelative(row.created_at)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/dashboard/submissions/${row.id}`}
                        className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline"
                      >
                        Open
                        <ArrowRight className="h-3 w-3" aria-hidden="true" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
