"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, ShieldCheck, Search, Check, X, RotateCcw } from "lucide-react"

import type { Profile, UserRole } from "@/lib/types"
import { cn } from "@/lib/utils"
import { roleLabel } from "@/lib/auth-shared"
import { setUserPermissionOverride } from "@/app/actions/permissions"
import type {
  PermissionDefinitionRow,
  RoleDefaultRow,
  UserOverrideRow,
} from "@/lib/permissions"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

interface Props {
  users: Profile[]
  definitions: PermissionDefinitionRow[]
  roleDefaults: RoleDefaultRow[]
  overrides: UserOverrideRow[]
}

type Effect = "allow" | "deny"
type CellState = "inherited_allow" | "inherited_deny" | "override_allow" | "override_deny"

function computeCellState(
  role: UserRole,
  capabilityKey: string,
  defaultsByRole: Map<UserRole, Set<string>>,
  override: Effect | undefined,
): CellState {
  if (override === "allow") return "override_allow"
  if (override === "deny") return "override_deny"
  const set = defaultsByRole.get(role) ?? new Set<string>()
  return set.has(capabilityKey) ? "inherited_allow" : "inherited_deny"
}

export function PermissionsMatrix({ users, definitions, roleDefaults, overrides }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [selectedUserId, setSelectedUserId] = useState<string | null>(
    users[0]?.id ?? null,
  )

  const defaultsByRole = useMemo(() => {
    const m = new Map<UserRole, Set<string>>()
    for (const r of roleDefaults) {
      const set = m.get(r.role) ?? new Set<string>()
      set.add(r.capability_key)
      m.set(r.role, set)
    }
    return m
  }, [roleDefaults])

  const overrideMap = useMemo(() => {
    const m = new Map<string, Effect>()
    for (const o of overrides) {
      m.set(`${o.user_id}::${o.capability_key}`, o.effect)
    }
    return m
  }, [overrides])

  // Group capabilities by module so the matrix is scannable.
  const grouped = useMemo(() => {
    const m = new Map<string, PermissionDefinitionRow[]>()
    for (const def of definitions) {
      const list = m.get(def.module) ?? []
      list.push(def)
      m.set(def.module, list)
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [definitions])

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (u) =>
        (u.full_name ?? "").toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q),
    )
  }, [users, search])

  const selectedUser = useMemo(
    () => users.find((u) => u.id === selectedUserId) ?? null,
    [users, selectedUserId],
  )

  function applyEffect(capabilityKey: string, effect: Effect | "clear") {
    if (!selectedUser) return
    setError(null)
    const opId = `${selectedUser.id}:${capabilityKey}:${effect}`
    setBusy(opId)
    start(async () => {
      const res = await setUserPermissionOverride({
        user_id: selectedUser.id,
        capability_key: capabilityKey,
        effect,
        reason: "",
      })
      setBusy(null)
      if (!res.ok) {
        setError(res.error ?? "Could not save.")
        return
      }
      router.refresh()
    })
  }

  if (users.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-[13px] text-muted-foreground">
        No managers or members to manage yet.
      </div>
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)] items-start">
      {/* User list ------------------------------------------------------ */}
      <aside className="rounded-xl border border-border bg-card shadow-card">
        <header className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Users
          </div>
          <div className="relative mt-2.5">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search users…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-[13px]"
            />
          </div>
        </header>
        <ul className="max-h-[640px] overflow-y-auto p-2">
          {filteredUsers.map((u) => {
            const overrideCount = overrides.filter((o) => o.user_id === u.id).length
            const active = u.id === selectedUserId
            return (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => setSelectedUserId(u.id)}
                  className={cn(
                    "w-full rounded-md px-2.5 py-2 text-left text-[13px] transition-colors",
                    active
                      ? "bg-sidebar-accent text-foreground"
                      : "text-foreground/85 hover:bg-sidebar-accent",
                  )}
                >
                  <div className="font-medium truncate">
                    {u.full_name ?? u.email}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{roleLabel(u.role)}</span>
                    {overrideCount > 0 ? (
                      <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                        {overrideCount} override{overrideCount === 1 ? "" : "s"}
                      </Badge>
                    ) : null}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </aside>

      {/* Matrix --------------------------------------------------------- */}
      <section className="rounded-xl border border-border bg-card shadow-card">
        <header className="flex flex-col gap-1 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold">
              {selectedUser
                ? selectedUser.full_name ?? selectedUser.email
                : "Select a user"}
            </h2>
            {selectedUser ? (
              <p className="text-[12px] text-muted-foreground">
                Role default: <strong>{roleLabel(selectedUser.role)}</strong>. Overrides take
                precedence (deny &gt; allow &gt; default).
              </p>
            ) : null}
          </div>
        </header>

        {error ? (
          <div className="mx-4 mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
            {error}
          </div>
        ) : null}

        {!selectedUser ? (
          <div className="p-8 text-center text-[13px] text-muted-foreground">
            Pick a user from the list to manage their capabilities.
          </div>
        ) : (
          <div className="p-4 space-y-6">
            {grouped.map(([moduleName, caps]) => (
              <div key={moduleName}>
                <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  {moduleName.replace(/_/g, " ")}
                </h3>
                <div className="overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-[13px]">
                    <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Capability</th>
                        <th className="px-3 py-2 text-left font-semibold">State</th>
                        <th className="px-3 py-2 text-right font-semibold">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {caps.map((cap) => {
                        const overrideEffect = overrideMap.get(
                          `${selectedUser.id}::${cap.key}`,
                        )
                        const state = computeCellState(
                          selectedUser.role,
                          cap.key,
                          defaultsByRole,
                          overrideEffect,
                        )
                        const opPrefix = `${selectedUser.id}:${cap.key}`
                        return (
                          <tr
                            key={cap.key}
                            className="border-t border-border first:border-t-0"
                          >
                            <td className="px-3 py-2.5">
                              <div className="font-medium">{cap.action.replace(/_/g, " ")}</div>
                              <div className="text-[11px] text-muted-foreground">
                                {cap.key}
                                {cap.is_admin_only ? (
                                  <Badge
                                    variant="outline"
                                    className="ml-2 h-4 px-1 text-[10px]"
                                  >
                                    admin only
                                  </Badge>
                                ) : null}
                              </div>
                              {cap.description ? (
                                <div className="mt-0.5 text-[11px] text-muted-foreground">
                                  {cap.description}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-3 py-2.5">
                              <StateBadge state={state} />
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center justify-end gap-1.5">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={
                                    state === "override_allow" ? "default" : "outline"
                                  }
                                  disabled={
                                    pending ||
                                    cap.is_admin_only ||
                                    state === "override_allow"
                                  }
                                  onClick={() => applyEffect(cap.key, "allow")}
                                  className="h-7 px-2 text-[12px]"
                                >
                                  {busy === `${opPrefix}:allow` ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Check className="h-3 w-3" />
                                  )}
                                  Allow
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={
                                    state === "override_deny" ? "destructive" : "outline"
                                  }
                                  disabled={pending || state === "override_deny"}
                                  onClick={() => applyEffect(cap.key, "deny")}
                                  className="h-7 px-2 text-[12px]"
                                >
                                  {busy === `${opPrefix}:deny` ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <X className="h-3 w-3" />
                                  )}
                                  Deny
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  disabled={
                                    pending ||
                                    (state !== "override_allow" && state !== "override_deny")
                                  }
                                  onClick={() => applyEffect(cap.key, "clear")}
                                  className="h-7 px-2 text-[12px]"
                                  title="Clear override and fall back to role default"
                                >
                                  {busy === `${opPrefix}:clear` ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <RotateCcw className="h-3 w-3" />
                                  )}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function StateBadge({ state }: { state: CellState }) {
  switch (state) {
    case "override_allow":
      return (
        <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
          Override allow
        </Badge>
      )
    case "override_deny":
      return (
        <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Override deny</Badge>
      )
    case "inherited_allow":
      return (
        <Badge variant="outline" className="border-emerald-300 text-emerald-700">
          Inherited allow
        </Badge>
      )
    case "inherited_deny":
      return (
        <Badge variant="outline" className="text-muted-foreground">
          Inherited deny
        </Badge>
      )
  }
}
