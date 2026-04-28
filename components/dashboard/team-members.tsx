import { Users } from "lucide-react"
import { roleLabel } from "@/lib/auth-shared"
import { formatRelative } from "@/lib/format"
import type { Profile, Team, UserRole } from "@/lib/types"

interface Props {
  members: Profile[]
  teams: Team[]
  viewerRole: UserRole
}

export function TeamMembers({ members, teams, viewerRole }: Props) {
  void viewerRole
  const teamMap = new Map(teams.map((t) => [t.id, t.name]))

  return (
    <section
      aria-labelledby="team-members-heading"
      className="rounded-xl border border-border bg-card shadow-card"
    >
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 lg:px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-warm-white">
          <Users className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 id="team-members-heading" className="text-[15px] font-semibold tracking-tight">
            Members
          </h2>
          <p className="text-[12px] text-muted-foreground">
            {members.length} {members.length === 1 ? "person" : "people"}
          </p>
        </div>
      </header>

      {members.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <p className="text-[13px] font-semibold">No members yet</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Provision the first account using the form alongside.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {members.map((m) => {
            const initials = (m.full_name ?? m.email)
              .split(/\s+|@/)
              .map((p) => p[0])
              .filter(Boolean)
              .slice(0, 2)
              .join("")
              .toUpperCase()
            const teamName = m.team_id ? teamMap.get(m.team_id) ?? "—" : "—"
            return (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3 lg:px-5">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-warm-white text-[12px] font-semibold">
                  {initials || "U"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold truncate">
                    {m.full_name ?? m.email}
                  </p>
                  <p className="text-[11.5px] text-muted-foreground truncate">
                    {m.email} · joined {formatRelative(m.created_at)}
                  </p>
                </div>
                <div className="hidden sm:flex flex-col items-end leading-tight">
                  <span className="text-[12px] font-semibold">{roleLabel(m.role)}</span>
                  <span className="text-[11px] text-muted-foreground">{teamName}</span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
