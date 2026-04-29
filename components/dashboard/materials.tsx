import { FolderOpen, Download } from "lucide-react"
import { fileIconLabel, formatBytes, formatRelative } from "@/lib/format"
import { DeleteIconButton } from "@/components/dashboard/delete-icon-button"
import { deleteMaterial } from "@/app/actions/materials"
import type { Material } from "@/lib/types"

interface MaterialsProps {
  rows: Material[]
  emptyHint?: string
  canDelete?: boolean
}

export function Materials({ rows, emptyHint, canDelete = false }: MaterialsProps) {
  return (
    <section
      aria-labelledby="materials-heading"
      className="rounded-xl border border-border bg-card shadow-card"
    >
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 lg:px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-warm-white">
          <FolderOpen className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id="materials-heading" className="text-[15px] font-semibold tracking-tight">
            Materials
          </h2>
          <p className="text-[12px] text-muted-foreground">
            Templates, references, and shared resources.
          </p>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-[13px] font-semibold">No materials yet</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {emptyHint ?? "Your manager hasn't shared anything yet."}
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 p-4">
          {rows.map((m) => (
            <li
              key={m.id}
              className="rounded-xl border border-border bg-background p-3.5 transition-shadow hover:shadow-card"
            >
              <div className="flex items-start gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warm-white text-[10.5px] font-semibold tracking-wide">
                  {fileIconLabel(m.file_type)}
                </span>
                <div className="min-w-0 flex-1">
                  {m.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {m.tags.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className="inline-flex items-center rounded-full bg-warm-white px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <h3 className="mt-1.5 text-[13.5px] font-semibold leading-snug truncate">{m.title}</h3>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {formatBytes(m.size_bytes)} · {formatRelative(m.created_at)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <a
                    href={`/api/download/${m.id}?type=material`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Download ${m.title}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                  </a>
                  {canDelete ? (
                    <DeleteIconButton
                      id={m.id}
                      action={deleteMaterial}
                      confirmText="Delete this material?"
                      label={`Delete ${m.title}`}
                    />
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
