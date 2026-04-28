import {
  FolderOpen,
  FileType2,
  FileText,
  Presentation,
  Video,
  Download,
  ArrowRight,
} from "lucide-react"
import { cn } from "@/lib/utils"

type Material = {
  id: string
  title: string
  category: string
  size: string
  kind: "pdf" | "doc" | "ppt" | "video"
  updatedAt: string
}

const materials: Material[] = [
  {
    id: "m1",
    title: "Quarterly Submission Playbook",
    category: "Onboarding",
    size: "3.4 MB",
    kind: "pdf",
    updatedAt: "Updated 2d ago",
  },
  {
    id: "m2",
    title: "LLM Validation Rules — v4",
    category: "Reference",
    size: "1.1 MB",
    kind: "doc",
    updatedAt: "Updated today",
  },
  {
    id: "m3",
    title: "Incident Postmortem Template",
    category: "Templates",
    size: "640 KB",
    kind: "doc",
    updatedAt: "Updated 5d ago",
  },
  {
    id: "m4",
    title: "Team Rituals · Walkthrough",
    category: "Training",
    size: "84 MB",
    kind: "video",
    updatedAt: "Updated 2w ago",
  },
  {
    id: "m5",
    title: "Brand & Reporting Slides",
    category: "Templates",
    size: "12.2 MB",
    kind: "ppt",
    updatedAt: "Updated 1w ago",
  },
  {
    id: "m6",
    title: "Vendor Risk Assessment Form",
    category: "Forms",
    size: "820 KB",
    kind: "pdf",
    updatedAt: "Updated 3d ago",
  },
]

const iconMap: Record<Material["kind"], React.ComponentType<{ className?: string }>> = {
  pdf: FileType2,
  doc: FileText,
  ppt: Presentation,
  video: Video,
}

const colorMap: Record<Material["kind"], string> = {
  pdf: "bg-[#fdecdc] text-[#dd5b00]",
  doc: "bg-[#f2f9ff] text-[#097fe8]",
  ppt: "bg-[#fce8f4] text-[#c11574]",
  video: "bg-[#f3eaff] text-[#6e3bb5]",
}

export function Materials() {
  return (
    <section
      id="materials"
      aria-labelledby="materials-heading"
      className="rounded-xl border border-border bg-card shadow-card"
    >
      <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-warm-white shrink-0">
            <FolderOpen className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 id="materials-heading" className="text-[16px] font-bold tracking-[-0.25px]">
              Materials repository
            </h2>
            <p className="text-[12px] font-medium text-muted-foreground">
              Documents, templates and resources for your team
            </p>
          </div>
        </div>
        <a
          href="#all-materials"
          className="hidden sm:inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline"
        >
          Browse library
          <ArrowRight className="h-3.5 w-3.5" />
        </a>
      </header>

      <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 p-4">
        {materials.map((m) => {
          const Icon = iconMap[m.kind]
          return (
            <li
              key={m.id}
              className="group rounded-xl border border-border bg-background p-3.5 transition-shadow hover:shadow-card"
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                    colorMap[m.kind],
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center rounded-full bg-warm-white px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground tracking-[0.125px]">
                      {m.category}
                    </span>
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {m.size}
                    </span>
                  </div>
                  <h3 className="mt-1.5 text-[14px] font-semibold leading-snug tracking-[-0.125px]">
                    {m.title}
                  </h3>
                  <p className="mt-0.5 text-[11.5px] font-medium text-muted-foreground">
                    {m.updatedAt}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Download ${m.title}`}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Download className="h-4 w-4" />
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
