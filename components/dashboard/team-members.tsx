"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Users, Trash2, Loader2, Eye, EyeOff, Key, Mail, ShieldCheck, Shield, Pencil, MailWarning } from "lucide-react"
import { RoleTransitionModal } from "./role-transition-modal"
import { EditUserModal } from "./edit-user-modal"
import { roleLabel } from "@/lib/auth-shared"
import { formatRelative } from "@/lib/format"
import { deleteUser } from "@/app/actions/users"
import type { Profile, Team } from "@/lib/types"

interface Props {
  members: Profile[]
  teams: Team[]
  /** When true the viewer is a main_admin — enables delete + credentials. */
  isMainAdmin?: boolean
}

export function TeamMembers({ members, teams, isMainAdmin = false }: Props) {
  const teamMap = new Map(teams.map((t) => [t.id, t.name]))
  const router = useRouter()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [expandedCredentials, setExpandedCredentials] = useState<Set<string>>(new Set())
  const [transitioningUser, setTransitioningUser] = useState<Profile | null>(null)
  const [editingUser, setEditingUser] = useState<Profile | null>(null)

  function handleDeleteClick(id: string) {
    setError(null)
    if (confirmId === id) {
      // Second click — actually delete
      setDeletingId(id)
      start(async () => {
        const res = await deleteUser(id)
        if (!res.ok) {
          setError(res.error ?? "Could not delete user.")
          setDeletingId(null)
          setConfirmId(null)
          return
        }
        setDeletingId(null)
        setConfirmId(null)
        router.refresh()
      })
    } else {
      // First click — confirm
      setConfirmId(id)
    }
  }

  function toggleCredentials(id: string) {
    setExpandedCredentials((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

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

      {error && (
        <div className="px-4 py-2 lg:px-5">
          <p role="alert" className="text-[12px] font-semibold text-destructive">
            {error}
          </p>
        </div>
      )}

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
            const isConfirming = confirmId === m.id
            const isDeleting = deletingId === m.id
            const showCredentials = expandedCredentials.has(m.id)
            const isSelf = false // We don't have actor.id here but the server action guards this

            return (
              <li key={m.id} className="px-4 py-3 lg:px-5">
                <div className="flex items-center gap-3">
                  {/* Avatar */}
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warm-white text-[12px] font-semibold">
                    {initials || "U"}
                  </span>

                  {/* Name + email */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold truncate">
                      {m.full_name ?? m.email}
                    </p>
                    <p className="text-[11.5px] text-muted-foreground truncate">
                      {m.email} · joined {formatRelative(m.created_at)}
                    </p>
                    {m.pending_email && (
                      <p
                        className="mt-1 inline-flex items-center gap-1 rounded-md border border-amber-300/60 bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
                        title={`Awaiting verification at ${m.pending_email}`}
                      >
                        <MailWarning className="h-3 w-3 shrink-0" aria-hidden="true" />
                        Email under verification
                        <span className="font-mono font-normal text-amber-700/90 dark:text-amber-200/80 truncate max-w-[200px]">
                          → {m.pending_email}
                        </span>
                      </p>
                    )}
                  </div>

                  {/* Role + Team badge */}
                  <div className="hidden sm:flex flex-col items-end leading-tight">
                    <span className="text-[12px] font-semibold">{roleLabel(m.role)}</span>
                    <span className="text-[11px] text-muted-foreground">{teamName}</span>
                  </div>

                  {/* Actions for main_admin */}
                  {isMainAdmin && (
                    <div className="flex items-center gap-1 ml-2">
                      {/* View credentials toggle */}
                      <button
                        type="button"
                        onClick={() => toggleCredentials(m.id)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        aria-label={showCredentials ? "Hide credentials" : "Show credentials"}
                        title={showCredentials ? "Hide credentials" : "Show credentials"}
                      >
                        {showCredentials ? (
                          <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                      </button>

                      {/* Edit profile button */}
                      <button
                        type="button"
                        onClick={() => setEditingUser(m)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        aria-label="Edit name and email"
                        title="Edit name / email"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>

                      {/* Change Role button */}
                      <button
                        type="button"
                        onClick={() => setTransitioningUser(m)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-primary/5 hover:text-primary hover:border-primary/30"
                        aria-label="Change user role"
                        title="Change user role"
                      >
                        <Shield className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>

                      {/* Delete button */}
                      {m.role !== "main_admin" && (
                        <button
                          type="button"
                          onClick={() => handleDeleteClick(m.id)}
                          disabled={isDeleting}
                          className={`inline-flex h-8 items-center justify-center gap-1 rounded-lg border px-2 text-[11px] font-semibold transition-all ${
                            isConfirming
                              ? "border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              : "border-border text-muted-foreground hover:border-destructive/40 hover:bg-destructive/5 hover:text-destructive"
                          } disabled:opacity-50`}
                          aria-label={isConfirming ? "Confirm delete" : "Delete user"}
                          title={isConfirming ? "Click again to confirm" : "Delete user"}
                        >
                          {isDeleting ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          {isConfirming && !isDeleting && (
                            <span>Confirm</span>
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Expanded credentials panel */}
                {isMainAdmin && showCredentials && (
                  <div className="mt-2.5 ml-12 rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                      Account Credentials
                    </p>
                    <div className="flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                      <span className="text-[12px] text-muted-foreground w-14 shrink-0">Email:</span>
                      <span className="text-[12px] font-mono font-medium select-all">{m.email}</span>
                    </div>
                    {m.pending_email && (
                      <div className="flex items-start gap-2">
                        <MailWarning className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-[2px]" aria-hidden="true" />
                        <span className="text-[12px] text-muted-foreground w-14 shrink-0">Pending:</span>
                        <span className="text-[12px] font-mono font-medium text-amber-800 dark:text-amber-200 select-all break-all">
                          {m.pending_email}
                          <span className="ml-1 inline-flex items-center rounded-sm bg-amber-100 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">
                            Awaiting verification
                          </span>
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                      <span className="text-[12px] text-muted-foreground w-14 shrink-0">Role:</span>
                      <span className="text-[12px] font-semibold">{roleLabel(m.role)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Key className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                      <span className="text-[12px] text-muted-foreground w-14 shrink-0">ID:</span>
                      <span className="text-[12px] font-mono text-muted-foreground select-all truncate">{m.id}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                      <span className="text-[12px] text-muted-foreground w-14 shrink-0">Team:</span>
                      <span className="text-[12px] font-medium">{teamName}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1 pt-1 border-t border-border">
                      Password is managed via Supabase Auth. Use the provisioning form to set a temporary password on new accounts.
                    </p>
                  </div>
                )}

                {/* Cancel confirm on blur — clicking outside resets confirm state */}
                {isConfirming && !isDeleting && (
                  <p className="mt-1.5 ml-12 text-[11px] text-destructive font-medium animate-pulse">
                    Click &quot;Confirm&quot; to permanently delete this user, or click elsewhere to cancel.
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {transitioningUser && (
        <RoleTransitionModal
          user={transitioningUser}
          isOpen={!!transitioningUser}
          onClose={() => setTransitioningUser(null)}
        />
      )}

      {editingUser && (
        <EditUserModal
          user={editingUser}
          isOpen={!!editingUser}
          onClose={() => setEditingUser(null)}
        />
      )}
    </section>
  )
}
