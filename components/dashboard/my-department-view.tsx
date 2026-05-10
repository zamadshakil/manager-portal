import { Building2, ShieldCheck, Users, User } from "lucide-react"
import type { MyDepartmentView } from "@/lib/data"
import type { Profile } from "@/lib/types"
import { roleLabel } from "@/lib/auth-shared"

interface Props {
  view: MyDepartmentView
  currentProfileId: string
}

function roleBadge(profile: Profile, managerId: string | null) {
  const isManager = profile.id === managerId || profile.role === "manager" || profile.role === "main_admin"
  if (isManager) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700">
        <ShieldCheck className="h-3 w-3" />
        Manager
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10.5px] font-semibold text-blue-700">
      <User className="h-3 w-3" />
      Team Member
    </span>
  )
}

export function MyDepartmentView({ view, currentProfileId }: Props) {
  const { department, manager, members } = view

  return (
    <div className="space-y-6">
      {/* Department Info Card */}
      <section className="rounded-xl border border-border bg-card shadow-card p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Building2 className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-[17px] font-bold tracking-tight">{department.name}</h2>
            {department.description && (
              <p className="mt-0.5 text-[13px] text-muted-foreground">{department.description}</p>
            )}
          </div>
        </div>
      </section>

      {/* Manager Section */}
      <section className="rounded-xl border border-border bg-card shadow-card">
        <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 lg:px-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-[14px] font-semibold tracking-tight">Department Manager</h3>
            <p className="text-[11.5px] text-muted-foreground">
              Oversees tasks and validation for this department.
            </p>
          </div>
        </header>

        <div className="p-4 lg:p-5">
          {manager ? (
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-[13px] font-semibold uppercase">
                {(manager.full_name ?? manager.email).charAt(0)}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold truncate">
                  {manager.full_name ?? manager.email}
                  {manager.id === currentProfileId && (
                    <span className="ml-2 text-[10px] font-bold tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded uppercase">
                      You
                    </span>
                  )}
                </p>
                <p className="text-[11.5px] text-muted-foreground truncate">{manager.email}</p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                <ShieldCheck className="h-3 w-3" /> Manager
              </span>
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground text-center py-3">
              No manager assigned to this department.
            </p>
          )}
        </div>
      </section>

      {/* Members Section */}
      <section className="rounded-xl border border-border bg-card shadow-card">
        <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 lg:px-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f2f9ff] text-primary">
            <Users className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-[14px] font-semibold tracking-tight">Department Members</h3>
            <p className="text-[11.5px] text-muted-foreground">
              {members.length} {members.length === 1 ? "member" : "members"} in this department.
            </p>
          </div>
        </header>

        {members.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <Users className="mx-auto h-8 w-8 text-muted-foreground opacity-40" />
            <p className="mt-3 text-[13px] font-semibold">No members</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {members.map((m) => (
              <li
                key={m.id}
                className={`flex items-center gap-3 px-4 py-3 lg:px-5 ${
                  m.id === currentProfileId ? "bg-primary/5" : "hover:bg-muted/30"
                }`}
              >
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-[12px] font-semibold uppercase">
                  {(m.full_name ?? m.email).charAt(0)}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold truncate flex items-center gap-2 flex-wrap">
                    {m.full_name ?? m.email}
                    {m.id === currentProfileId && (
                      <span className="text-[10px] font-bold tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded uppercase">
                        You
                      </span>
                    )}
                  </p>
                  <p className="text-[11.5px] text-muted-foreground truncate">{m.email}</p>
                </div>
                {roleBadge(m, department.manager_id)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
