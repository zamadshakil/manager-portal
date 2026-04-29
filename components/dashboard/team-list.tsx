"use client"

import { useState } from "react"
import { Edit2, Trash2 } from "lucide-react"
import type { Team, Profile } from "@/lib/types"

interface TeamListProps {
  teams: Team[]
  profiles: Profile[]
  onEdit: (team: Team) => void
  onDelete: (teamId: string) => void
}

export function TeamList({ teams, profiles, onEdit, onDelete }: TeamListProps) {
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null)

  const getManagerName = (managerId: string | null) => {
    if (!managerId) return "Unassigned"
    const manager = profiles.find((p) => p.id === managerId)
    return manager ? manager.full_name || manager.email : "Unknown manager"
  }

  if (teams.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
        <p className="text-[13px] text-muted-foreground">
          No teams yet. Create your first team above.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {teams.map((team) => (
        <div
          key={team.id}
          className="rounded-lg border border-border bg-card hover:border-ring transition-colors"
        >
          <button
            onClick={() =>
              setExpandedTeamId(expandedTeamId === team.id ? null : team.id)
            }
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors"
          >
            <div className="text-left flex-1">
              <h3 className="text-[13px] font-semibold text-foreground">{team.name}</h3>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                Manager: {getManagerName(team.manager_id)}
              </p>
            </div>
            <svg
              className={`h-4 w-4 text-muted-foreground transition-transform ${
                expandedTeamId === team.id ? "rotate-180" : ""
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </button>

          {expandedTeamId === team.id && (
            <div className="border-t border-border px-4 py-3 bg-muted/20 space-y-3">
              {team.description && (
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground mb-1">
                    Description
                  </p>
                  <p className="text-[12px] text-foreground">{team.description}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <p className="text-muted-foreground">Team ID</p>
                  <p className="font-mono text-[10px] text-foreground break-all">{team.id}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Created</p>
                  <p className="text-foreground">
                    {new Date(team.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => onEdit(team)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 transition-colors"
                >
                  <Edit2 className="h-3 w-3" aria-hidden="true" />
                  Edit
                </button>
                <button
                  onClick={() => {
                    if (
                      confirm(`Are you sure you want to delete "${team.name}"? This action cannot be undone.`)
                    ) {
                      onDelete(team.id)
                    }
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
