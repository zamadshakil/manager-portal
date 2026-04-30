import Link from "next/link"
import { Users, ChevronRight, UserCog } from "lucide-react"
import type { DepartmentWithStats } from "@/lib/data"

interface Props {
  departments: DepartmentWithStats[]
}

export function DepartmentList({ departments }: Props) {
  if (departments.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center shadow-card">
        <Users className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <p className="mt-3 text-[14px] font-semibold">No departments found</p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Create the first department to start organizing your workspace.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {departments.map((dept) => (
        <Link
          key={dept.id}
          href={`/dashboard/departments/${dept.id}`}
          className="group flex flex-col rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/30 hover:shadow-card hover:bg-muted/10"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Users className="h-4 w-4" aria-hidden="true" />
              </span>
              <h3 className="text-[14px] font-semibold tracking-tight line-clamp-1">
                {dept.name}
              </h3>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-primary" />
          </div>

          <p className="mt-3 flex-1 text-[12px] text-muted-foreground line-clamp-2 min-h-[36px]">
            {dept.description || "No description provided."}
          </p>

          <div className="mt-4 flex items-center gap-4 border-t border-border/50 pt-3 text-[11.5px] font-medium text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              <span>
                {dept.member_count} member{dept.member_count === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex items-center gap-1.5 truncate">
              <UserCog className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {dept.manager ? dept.manager.full_name || dept.manager.email : "No manager"}
              </span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  )
}
