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
    <div className="grid gap-6 lg:gap-8 lg:grid-cols-[minmax(0,1fr)_360px] items-start">
      {/* Teams List */}
      <div className="min-w-0">
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

        <TeamList
          teams={teams}
          profiles={managers}
          onEdit={(team) => {
            setDeleteError(null)
            setEditingTeam(team)
            if (typeof window !== "undefined" && window.innerWidth < 1024) {
              window.scrollTo({ top: 0, behavior: "smooth" })
            }
          }}
          onDelete={handleDeleteTeam}
        />
      </div>

      {/* Create/Edit Form */}
      <div className="min-w-0 lg:sticky lg:top-6">
        <TeamCreatorForm
          teams={teams}
          managers={managers}
          editingTeam={editingTeam}
          onCancelEdit={() => setEditingTeam(null)}
        />
      </div>
    </div>
  )
}
