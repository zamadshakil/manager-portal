"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  Shield,
  ArrowRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  DollarSign,
  Trash2,
  FileCheck,
  Users,
  Bot,
  MessageSquare,
  ClipboardList,
  BookOpen,
  Settings2,
} from "lucide-react"
import { updateUserRole } from "@/app/actions/users"
import { roleLabel } from "@/lib/auth-shared"
import type { Profile, Team, UserRole } from "@/lib/types"

interface Props {
  user: Profile
  teams: Team[]
  isOpen: boolean
  onClose: () => void
}

const PERMISSIONS = [
  {
    id: "user_mgmt",
    label: "User provisioning & deletion",
    description: "Create, edit, and permanently delete user accounts across all teams.",
    icon: Users,
    roles: ["main_admin"] as string[],
  },
  {
    id: "ai_credits",
    label: "Unlimited AI credits",
    description: "Unrestricted access to the Smart AI assistant with no monthly message cap.",
    icon: Bot,
    roles: ["main_admin"] as string[],
  },
  {
    id: "settings",
    label: "System settings & global rules",
    description: "Manage organisation-wide validation rules, integrations, and portal settings.",
    icon: Settings2,
    roles: ["main_admin"] as string[],
  },
  {
    id: "deletion",
    label: "Irreversible data deletion",
    description: "Permanently purge submissions, tasks, and team records from the system.",
    icon: Trash2,
    roles: ["main_admin"] as string[],
  },
  {
    id: "tasks",
    label: "Task creation & assignment",
    description: "Create tasks, set deadlines, assign members, and review submissions.",
    icon: ClipboardList,
    roles: ["main_admin", "manager"] as string[],
  },
  {
    id: "team_rules",
    label: "Team validation rules",
    description: "Author and manage team-scoped AI validation rules for submissions.",
    icon: BookOpen,
    roles: ["main_admin", "manager"] as string[],
  },
  {
    id: "approvals",
    label: "Submission review & override",
    description: "Override submission statuses and approve or reject flagged work.",
    icon: FileCheck,
    roles: ["main_admin", "manager"] as string[],
  },
  {
    id: "submit",
    label: "Submit work & Smart AI (credit-limited)",
    description: "Upload and submit assignments; access the AI assistant within the monthly credit limit.",
    icon: DollarSign,
    roles: ["main_admin", "manager", "member"] as string[],
  },
  {
    id: "messaging",
    label: "Team messaging",
    description: "Send and receive messages in direct and group conversations.",
    icon: MessageSquare,
    roles: ["main_admin", "manager", "member"] as string[],
  },
]

export function RoleTransitionModal({ user, teams, isOpen, onClose }: Props) {
  const router = useRouter()
  const [newRole, setNewRole] = useState<UserRole>(user.role)
  const [teamId, setTeamId] = useState<string | null>(user.team_id ?? null)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  // Teams selectable when assigning the Manager role: those with no owner,
  // or the one this user already owns (so we can "re-affirm" without error).
  const availableTeams = teams.filter(
    (t) => !t.manager_id || t.manager_id === user.id,
  )

  const needsTeam = newRole === "manager"
  const teamMissing = needsTeam && !teamId
  const unchanged =
    newRole === user.role &&
    (newRole !== "manager" || (teamId ?? null) === (user.team_id ?? null))

  async function handleConfirm() {
    setError(null)
    if (teamMissing) {
      setError("Select a team before assigning the Manager role.")
      return
    }
    startTransition(async () => {
      const result = await updateUserRole(
        user.id,
        newRole,
        newRole === "manager" ? teamId : null,
      )
      if (result.ok) {
        router.refresh()
        onClose()
      } else {
        setError(result.error ?? "An unexpected error occurred.")
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-2xl animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
      >
        <header className="border-b border-border bg-muted/30 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight">Role Transition Engine</h2>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                Auditing impact for {user.full_name ?? user.email}
              </p>
            </div>
          </div>
        </header>

        <div className="p-6 space-y-6">
          {/* Role Selector */}
          <div className="grid grid-cols-3 gap-3">
            {(["member", "manager", "main_admin"] as UserRole[]).map((role) => (
              <button
                key={role}
                onClick={() => setNewRole(role)}
                disabled={isPending}
                className={`relative flex flex-col items-center gap-1.5 rounded-xl border p-3 transition-all ${
                  newRole === role
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:border-primary/50 hover:bg-muted/50"
                }`}
              >
                {role === user.role && (
                  <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full border border-border bg-muted px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">
                    Current
                  </span>
                )}
                <span className={`text-[13px] font-bold ${newRole === role ? "text-primary" : "text-foreground"}`}>
                  {roleLabel(role)}
                </span>
              </button>
            ))}
          </div>

          {/* Permissions Preview */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              Permissions Preview
              <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded uppercase text-muted-foreground tracking-tighter">Impact Audit</span>
            </h3>
            
            <div className="rounded-xl border border-border divide-y divide-border overflow-hidden bg-muted/10">
              {PERMISSIONS.map((perm) => {
                const hasCurrent = perm.roles.includes(user.role)
                const willHave = perm.roles.includes(newRole)
                const Icon = perm.icon

                return (
                  <div key={perm.id} className="flex items-start gap-4 p-3.5 transition-colors">
                    <div className={`mt-0.5 rounded-lg p-2 ${willHave ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="text-[13px] font-semibold">{perm.label}</p>
                        <div className="flex items-center gap-1.5">
                          {hasCurrent !== willHave && (
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                                willHave
                                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                  : "bg-rose-500/10 text-rose-700 dark:text-rose-400"
                              }`}
                            >
                              {willHave ? "Added" : "Removed"}
                            </span>
                          )}
                          {willHave ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          ) : (
                            <XCircle className="h-4 w-4 text-muted-foreground/30" />
                          )}
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">
                        {perm.description}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Team selector — only relevant when assigning the Manager role. */}
          {needsTeam && (
            <div className="space-y-2">
              <label className="text-sm font-semibold" htmlFor="role-team-select">
                Team to manage
              </label>
              <select
                id="role-team-select"
                value={teamId ?? ""}
                onChange={(e) => setTeamId(e.target.value || null)}
                disabled={isPending}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              >
                <option value="" disabled>
                  — Select a team —
                </option>
                {availableTeams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {availableTeams.length === 0 ? (
                <p className="text-[11px] text-amber-700 dark:text-amber-300">
                  No teams are currently available. Reassign or remove an existing
                  manager first, or create a new team on the Departments page.
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Managers must own exactly one team. The team&apos;s current
                  manager (if any) will be replaced on confirm.
                </p>
              )}
            </div>
          )}

          {/* Security Guardrails */}
          {newRole !== user.role && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="text-[12px] leading-relaxed">
                <p className="font-bold">Security Enforcement</p>
                <p className="opacity-90">
                  Changing this role will <strong>invalidate all active sessions</strong> and clear refresh tokens. 
                  The user will be required to re-authenticate to gain their new access level.
                </p>
              </div>
            </div>
          )}

          {error && (
            <p className="text-[12px] font-bold text-destructive flex items-center gap-1.5 animate-in slide-in-from-top-2">
              <XCircle className="h-4 w-4" />
              {error}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-3 border-t border-border bg-muted/30 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-lg px-4 py-2 text-[13px] font-semibold hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isPending || unchanged || teamMissing}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2 text-[13px] font-bold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:grayscale disabled:hover:scale-100"
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                Confirm Transition
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </footer>
      </div>
    </div>
  )
}
