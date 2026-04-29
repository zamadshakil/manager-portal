"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { deleteTeam } from "@/app/actions/teams"
import { TeamCreatorForm } from "./team-creator-form"
import { TeamList } from "./team-list"
import type { Team, Profile } from "@/lib/types"

interface TeamAdminPanelProps {
  teams: Team[]
  managers: Profile[]
}

export function TeamAdminPanel({ teams, managers }: TeamAdminPanelProps) {
  const router = useRouter()
  const [editingTeam, setEditingTeam] = useState<Team | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function handleDeleteTeam(teamId: string) {
    setDeleteError(null)
    const fd = new FormData()
    fd.set("team_id", teamId)

    start(async () => {
      const res = await deleteTeam(fd)
      if (!res.ok) {
        setDeleteError(res.error ?? "Could not delete team.")
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-8">
      {/* Create/Edit Form */}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div />
        <TeamCreatorForm
          teams={teams}
          managers={managers}
          editingTeam={editingTeam}
        />
      </div>

      {/* Teams List */}
      <div>
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-foreground">Existing teams</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Click a team to view details, edit, or delete.
          </p>
        </div>

        {deleteError && (
          <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-[12px] font-semibold">
            {deleteError}
          </div>
        )}

        <div className="max-w-2xl">
          <TeamList
            teams={teams}
            profiles={managers}
            onEdit={(team) => {
              setDeleteError(null)
              setEditingTeam(team)
              window.scrollTo({ top: 0, behavior: "smooth" })
            }}
            onDelete={handleDeleteTeam}
          />
        </div>

        {editingTeam && (
          <div className="mt-4">
            <button
              onClick={() => setEditingTeam(null)}
              className="text-[12px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Cancel edit
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
