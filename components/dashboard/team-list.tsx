"use client"

import { useState } from "react"
import { ChevronDown, Edit2, Trash2 } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type { Team, Profile } from "@/lib/types"

interface TeamListProps {
  teams: Team[]
  profiles: Profile[]
  onEdit: (team: Team) => void
  onDelete: (teamId: string) => void
}

export function TeamList({ teams, profiles, onEdit, onDelete }: TeamListProps) {
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Team | null>(null)

  const getManagerName = (managerId: string | null) => {
    if (!managerId) return "Unassigned"
    const manager = profiles.find((p) => p.id === managerId)
    return manager ? manager.full_name || manager.email : "Unknown manager"
  }

  if (teams.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
        <p className="text-[13px] text-muted-foreground">
          No teams yet. Create your first team using the form alongside.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-2">
        {teams.map((team) => {
          const isExpanded = expandedTeamId === team.id
          return (
            <div
              key={team.id}
              className="rounded-lg border border-border bg-card hover:border-ring transition-colors"
            >
              <button
                onClick={() => setExpandedTeamId(isExpanded ? null : team.id)}
                aria-expanded={isExpanded}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors"
              >
                <div className="text-left flex-1 min-w-0">
                  <h3 className="text-[13px] font-semibold text-foreground truncate">
                    {team.name}
                  </h3>
                  <p className="text-[12px] text-muted-foreground mt-0.5 truncate">
                    Manager: {getManagerName(team.manager_id)}
                  </p>
                </div>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                    isExpanded ? "rotate-180" : ""
                  }`}
                  aria-hidden="true"
                />
              </button>

              {isExpanded && (
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
                      onClick={() => setPendingDelete(team)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete team?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `"${pendingDelete.name}" will be permanently removed. Members and submissions on this team will be unassigned. This action cannot be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete) {
                  onDelete(pendingDelete.id)
                  setPendingDelete(null)
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete team
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
