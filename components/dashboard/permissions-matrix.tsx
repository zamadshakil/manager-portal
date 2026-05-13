"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  CheckSquare,
  Clock,
  Download,
  History,
  Info,
  Loader2,
  RotateCcw,
  Search,
  Shield,
  ShieldCheck,
  Square,
  X,
} from "lucide-react"

import type { Profile, UserRole } from "@/lib/types"
import { cn } from "@/lib/utils"
import { roleLabel } from "@/lib/auth-shared"
import {
  bulkSetUserPermissionOverrides,
  loadPermissionHistory,
  setUserPermissionOverride,
  type PermissionHistoryEntry,
} from "@/app/actions/permissions"
import type { PermissionDefinitionRow, RoleDefaultRow, UserOverrideRow } from "@/lib/permissions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  users: Profile[]
  definitions: PermissionDefinitionRow[]
  roleDefaults: RoleDefaultRow[]
  overrides: UserOverrideRow[]
}

type Effect = "allow"
type CellState = "inherited_allow" | "inherited_deny" | "override_allow"

// ─── UI-only capability display tweaks ────────────────────────────────────────
//
// Some capabilities are kept in the DB / RLS layer but should not be exposed in
// the admin matrix because either (a) the feature is not wired through the app
// today, or (b) the display label doesn't match the runtime effect. These maps
// keep the cosmetic adjustments next to the component instead of forcing a DB
// migration just for relabelling.

const HIDDEN_CAPABILITY_KEYS = new Set<string>([
  // create / delete on submissions are not surfaced anywhere in the product UI
  // yet (no "delete submission" button, submissions are created via the task
  // upload flow which is gated separately). Hide them to avoid confusing admins.
  "submissions.create",
  "submissions.delete",
  // `tasks.assign` is not surfaced in the product UI: there is no standalone
  // "assign existing task" flow — assignment is performed automatically as
  // part of task creation (gated by `tasks.create`). Toggling this override
  // therefore has no observable effect, so hide it to avoid confusing admins.
  "tasks.assign",
  // AI credits capabilities are intentionally not configurable through the
  // admin matrix — access to `/dashboard/my-credits` and the admin AI credit
  // tools is governed by role at runtime. Exposing per-user toggles here led
  // to confusing states (e.g. granting `manage` to a non-admin had no effect
  // because the admin pages also require admin role). Hide the rows; the
  // capability rows remain in the DB so existing role defaults still apply.
  "ai_credits.read_self",
  "ai_credits.read_all",
  "ai_credits.manage",
])

const CAPABILITY_DISPLAY_OVERRIDES: Record<string, { action?: string; description?: string }> = {
  // `submissions.update` actually controls whether a user can see the full
  // team's submissions (vs. only their own). The legacy "Update submission
  // status / metadata" label is misleading — rename to match real behaviour.
  "submissions.update": {
    action: "Show all submissions",
    description:
      "View every submission from the user's team. When denied/inherited deny, the user only sees their own submissions.",
  },
}

function displayCap(cap: PermissionDefinitionRow): PermissionDefinitionRow {
  const o = CAPABILITY_DISPLAY_OVERRIDES[cap.key]
  if (!o) return cap
  return {
    ...cap,
    action: o.action ?? cap.action,
    description: o.description ?? cap.description,
  }
}

interface OverrideDialogTarget {
  userIds: string[]
  capKey: string
  currentEffect: Effect | null
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function computeCellState(
  role: UserRole,
  capabilityKey: string,
  defaultsByRole: Map<UserRole, Set<string>>,
  override: Effect | undefined,
): CellState {
  if (override === "allow") return "override_allow"
  return (defaultsByRole.get(role) ?? new Set()).has(capabilityKey)
    ? "inherited_allow"
    : "inherited_deny"
}

function buildDefaultsByRole(roleDefaults: RoleDefaultRow[]) {
  const m = new Map<UserRole, Set<string>>()
  for (const r of roleDefaults) {
    const s = m.get(r.role) ?? new Set<string>()
    s.add(r.capability_key)
    m.set(r.role, s)
  }
  return m
}

function buildOverrideMap(overrides: UserOverrideRow[]) {
  const m = new Map<string, UserOverrideRow>()
  for (const o of overrides) m.set(`${o.user_id}::${o.capability_key}`, o)
  return m
}

function groupByModule(definitions: PermissionDefinitionRow[]) {
  const m = new Map<string, PermissionDefinitionRow[]>()
  for (const d of definitions) {
    const list = m.get(d.module) ?? []
    list.push(d)
    m.set(d.module, list)
  }
  return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]))
}

function exportCSV(
  users: Profile[],
  definitions: PermissionDefinitionRow[],
  defaultsByRole: Map<UserRole, Set<string>>,
  overrideMap: Map<string, UserOverrideRow>,
) {
  const header = ["User", "Email", "Role", ...definitions.map((d) => d.key)]
  const rows = users.map((u) => {
    const cells = definitions.map((d) => {
      const ov = overrideMap.get(`${u.id}::${d.key}`)
      if (ov) return "override_allow"
      return (defaultsByRole.get(u.role) ?? new Set()).has(d.key) ? "inherited_allow" : "inherited_deny"
    })
    return [u.full_name ?? "", u.email, u.role, ...cells]
  })
  const csv = [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n")
  const blob = new Blob([csv], { type: "text/csv" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `permissions-export-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StateBadge({ state }: { state: CellState }) {
  switch (state) {
    case "override_allow":
      return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-300">Override allow</Badge>
    case "inherited_allow":
      return <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:text-emerald-400">Inherited allow</Badge>
    case "inherited_deny":
      return <Badge variant="outline" className="text-muted-foreground">Inherited deny</Badge>
  }
}

function ExplainPopover({
  userId, capKey, role, state, override, defaultsByRole,
}: {
  userId: string; capKey: string; role: UserRole; state: CellState
  override: UserOverrideRow | undefined
  defaultsByRole: Map<UserRole, Set<string>>
}) {
  const steps: { label: string; active: boolean }[] = [
    { label: "main_admin always allowed (not applicable)", active: false },
    override?.effect === "allow"
      ? { label: `Explicit allow override by ${override.granted_by_name ?? "admin"}`, active: true }
      : { label: "No allow override", active: false },
    (defaultsByRole.get(role) ?? new Set()).has(capKey)
      ? { label: `Role default allows (${role})`, active: true }
      : { label: `Role default denies (${role})`, active: false },
  ]

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="text-muted-foreground hover:text-foreground transition-colors" title="Explain decision">
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 text-[12px]" side="left">
        <p className="mb-2 font-semibold text-[13px]">Decision chain for <code className="text-[11px]">{capKey}</code></p>
        <ol className="space-y-1.5">
          {steps.map((s, i) => (
            <li key={i} className={cn("flex items-start gap-2", s.active ? "text-foreground font-medium" : "text-muted-foreground")}>
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px]">{i + 1}</span>
              {s.label}
            </li>
          ))}
        </ol>
        <Separator className="my-2" />
        <p className="text-muted-foreground">
          Result: <span className={cn("font-semibold", state.includes("allow") ? "text-emerald-600" : "text-red-500")}>
            {state.replace(/_/g, " ")}
          </span>
          {override?.expires_at && (
            <span className="ml-1 text-amber-600">(expires {new Date(override.expires_at).toLocaleDateString()})</span>
          )}
        </p>
      </PopoverContent>
    </Popover>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PermissionsMatrix({ users, definitions, roleDefaults, overrides }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()

  // ── Derived data ──
  // Hide capabilities that aren't surfaced in the product UI yet, and rewrite
  // the display label/description for capabilities whose legacy name doesn't
  // match what they actually control at runtime.
  const visibleDefinitions = useMemo(
    () => definitions.filter((d) => !HIDDEN_CAPABILITY_KEYS.has(d.key)).map(displayCap),
    [definitions],
  )
  const defaultsByRole = useMemo(() => buildDefaultsByRole(roleDefaults), [roleDefaults])
  const overrideMap = useMemo(() => buildOverrideMap(overrides), [overrides])
  const grouped = useMemo(() => groupByModule(visibleDefinitions), [visibleDefinitions])
  const modules = useMemo(() => grouped.map(([m]) => m), [grouped])

  // ── Filter state ──
  const [userSearch, setUserSearch] = useState("")
  const [filterRole, setFilterRole] = useState<string>("all")
  const [filterModule, setFilterModule] = useState<string>("all")
  const [capSearch, setCapSearch] = useState("")

  // ── Selection state ──
  const [selectedUserId, setSelectedUserId] = useState<string | null>(users[0]?.id ?? null)
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set())

  // ── Override dialog ──
  const [overrideTarget, setOverrideTarget] = useState<OverrideDialogTarget | null>(null)
  const [overrideEffect, setOverrideEffect] = useState<Effect | "clear">("allow")
  const [overrideReason, setOverrideReason] = useState("")
  const [overrideExpiry, setOverrideExpiry] = useState("")
  const [overrideSaving, setOverrideSaving] = useState(false)
  const [overrideError, setOverrideError] = useState<string | null>(null)

  // ── History sheet ──
  const [historyUserId, setHistoryUserId] = useState<string | null>(null)
  const [historyEntries, setHistoryEntries] = useState<PermissionHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  // ── Filtered lists ──
  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase()
    return users.filter((u) => {
      if (filterRole !== "all" && u.role !== filterRole) return false
      if (q && !(u.full_name ?? "").toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) return false
      return true
    })
  }, [users, userSearch, filterRole])

  const filteredGrouped = useMemo(() => {
    const q = capSearch.trim().toLowerCase()
    return grouped
      .filter(([mod]) => filterModule === "all" || mod === filterModule)
      .map(([mod, caps]) => [mod, caps.filter((c) =>
        !q || c.key.toLowerCase().includes(q) || c.action.toLowerCase().includes(q)
      )] as [string, PermissionDefinitionRow[]])
      .filter(([, caps]) => caps.length > 0)
  }, [grouped, filterModule, capSearch])

  const selectedUser = useMemo(() => users.find((u) => u.id === selectedUserId) ?? null, [users, selectedUserId])

  // ── Unique roles for filter ──
  const roles = useMemo(() => [...new Set(users.map((u) => u.role))], [users])

  // ── Bulk selection helpers ──
  const allSelected = filteredUsers.length > 0 && filteredUsers.every((u) => selectedUserIds.has(u.id))
  const someSelected = selectedUserIds.size > 0

  function toggleUser(id: string) {
    setSelectedUserIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAllFiltered() {
    if (allSelected) {
      setSelectedUserIds((prev) => {
        const next = new Set(prev)
        filteredUsers.forEach((u) => next.delete(u.id))
        return next
      })
    } else {
      setSelectedUserIds((prev) => {
        const next = new Set(prev)
        filteredUsers.forEach((u) => next.add(u.id))
        return next
      })
    }
  }

  // ── Override dialog opener ──
  function openOverrideDialog(userIds: string[], capKey: string) {
    const existingRow = userIds.length === 1
      ? overrideMap.get(`${userIds[0]}::${capKey}`) ?? null
      : null
    const existingEffect = existingRow?.effect ?? null
    setOverrideTarget({ userIds, capKey, currentEffect: existingEffect })
    setOverrideEffect(existingEffect ?? "allow")
    // Prefill reason / expiry from the existing override so admins can see and
    // edit them rather than starting from a blank form every time.
    setOverrideReason(existingRow?.reason ?? "")
    setOverrideExpiry(
      existingRow?.expires_at ? existingRow.expires_at.slice(0, 10) : "",
    )
    setOverrideError(null)
  }

  function closeOverrideDialog() {
    setOverrideTarget(null)
  }

  async function handleSaveOverride() {
    if (!overrideTarget) return
    setOverrideSaving(true)
    setOverrideError(null)

    const expiresAt = overrideExpiry
      ? new Date(overrideExpiry + "T23:59:59Z").toISOString()
      : null

    let res: { ok: boolean; error?: string }
    if (overrideTarget.userIds.length === 1) {
      res = await setUserPermissionOverride({
        user_id: overrideTarget.userIds[0],
        capability_key: overrideTarget.capKey,
        effect: overrideEffect,
        reason: overrideReason,
        expires_at: expiresAt,
      })
    } else {
      res = await bulkSetUserPermissionOverrides({
        user_ids: overrideTarget.userIds,
        capability_keys: [overrideTarget.capKey],
        effect: overrideEffect,
        reason: overrideReason,
        expires_at: expiresAt,
      })
    }

    setOverrideSaving(false)
    if (!res.ok) { setOverrideError(res.error ?? "Could not save."); return }
    closeOverrideDialog()
    router.refresh()
  }

  // ── Bulk apply (selected users × selected capability) ──
  function openBulkDialog(capKey: string) {
    if (selectedUserIds.size === 0) return
    openOverrideDialog([...selectedUserIds], capKey)
  }

  // ── History ──
  async function openHistory(userId: string) {
    setHistoryUserId(userId)
    setHistoryLoading(true)
    setHistoryEntries([])
    const res = await loadPermissionHistory(userId)
    setHistoryLoading(false)
    setHistoryEntries(res.history ?? [])
  }

  // ── CSV export ──
  function handleExport() {
    exportCSV(users, visibleDefinitions, defaultsByRole, overrideMap)
  }

  if (users.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-[13px] text-muted-foreground">
        No managers or members to manage yet.
      </div>
    )
  }

  return (
    <>
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="relative w-full min-w-0 sm:w-auto">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search capabilities…"
              value={capSearch}
              onChange={(e) => setCapSearch(e.target.value)}
              className="h-8 w-full pl-8 text-[13px] sm:w-44"
            />
          </div>
          <Select value={filterModule} onValueChange={setFilterModule}>
            <SelectTrigger className="h-8 w-full text-[13px] sm:w-36">
              <SelectValue placeholder="Module" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All modules</SelectItem>
              {modules.map((m) => (
                <SelectItem key={m} value={m}>{m.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 sm:flex-nowrap">
          {someSelected && (
            <Badge variant="secondary" className="text-[12px]">
              {selectedUserIds.size} user{selectedUserIds.size > 1 ? "s" : ""} selected
            </Badge>
          )}
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-[12px]" onClick={handleExport}>
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)] items-start">
        {/* ── User list ──────────────────────────────────────────────────── */}
        <aside className="rounded-xl border border-border bg-card shadow-sm">
          <header className="border-b border-border px-4 py-3 space-y-2">
            <div className="flex items-center gap-2 text-[13px] font-semibold">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Users
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search users…"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                className="h-8 pl-8 text-[13px]"
              />
            </div>
            <Select value={filterRole} onValueChange={setFilterRole}>
              <SelectTrigger className="h-8 text-[13px]">
                <SelectValue placeholder="Role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                {roles.map((r) => (
                  <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {filteredUsers.length > 0 && (
              <button
                type="button"
                onClick={toggleAllFiltered}
                className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {allSelected
                  ? <CheckSquare className="h-3.5 w-3.5" />
                  : <Square className="h-3.5 w-3.5" />}
                {allSelected ? "Deselect all" : "Select all visible"}
              </button>
            )}
          </header>

          <ScrollArea className="h-[260px] lg:h-[540px]">
            <ul className="p-2">
              {filteredUsers.map((u) => {
                const overrideCount = overrides.filter((o) => o.user_id === u.id).length
                const active = u.id === selectedUserId
                const checked = selectedUserIds.has(u.id)
                return (
                  <li key={u.id} className="flex items-center gap-1.5">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleUser(u.id)}
                      className="ml-1 shrink-0"
                    />
                    <button
                      type="button"
                      onClick={() => setSelectedUserId(u.id)}
                      className={cn(
                        "min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
                        active ? "bg-sidebar-accent text-foreground" : "text-foreground/85 hover:bg-sidebar-accent",
                      )}
                    >
                      <div className="font-medium truncate">{u.full_name ?? u.email}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{roleLabel(u.role)}</span>
                        {overrideCount > 0 && (
                          <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                            {overrideCount} override{overrideCount === 1 ? "" : "s"}
                          </Badge>
                        )}
                      </div>
                    </button>
                    <button
                      type="button"
                      title="View history"
                      onClick={() => openHistory(u.id)}
                      className="mr-1 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <History className="h-3.5 w-3.5" />
                    </button>
                  </li>
                )
              })}
              {filteredUsers.length === 0 && (
                <li className="py-6 text-center text-[12px] text-muted-foreground">No users match filters.</li>
              )}
            </ul>
          </ScrollArea>
        </aside>

        {/* ── Capability matrix ──────────────────────────────────────────── */}
        <section className="rounded-xl border border-border bg-card shadow-sm">
          <header className="flex flex-col gap-1 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold">
                {someSelected && selectedUserIds.size > 1
                  ? `${selectedUserIds.size} users selected — bulk edit mode`
                  : selectedUser
                    ? selectedUser.full_name ?? selectedUser.email
                    : "Select a user"}
              </h2>
              {selectedUser && !(someSelected && selectedUserIds.size > 1) && (
                <p className="text-[12px] text-muted-foreground">
                  Role: <strong>{roleLabel(selectedUser.role)}</strong> · override allow &gt; role default
                </p>
              )}
              {someSelected && selectedUserIds.size > 1 && (
                <p className="text-[12px] text-muted-foreground">
                  Click any cell action to apply the same override to all selected users.
                </p>
              )}
            </div>
            {selectedUser && !(someSelected && selectedUserIds.size > 1) && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-[12px] shrink-0"
                onClick={() => openHistory(selectedUser.id)}
              >
                <History className="h-3.5 w-3.5" />
                History
              </Button>
            )}
          </header>

          {!selectedUser && !(someSelected && selectedUserIds.size > 1) ? (
            <div className="p-8 text-center text-[13px] text-muted-foreground">
              Select a user from the list to manage their capabilities.
            </div>
          ) : (
            <div className="p-4 space-y-5">
              {filteredGrouped.map(([moduleName, caps]) => (
                <div key={moduleName}>
                  <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                    {moduleName.replace(/_/g, " ")}
                  </h3>
                  <div className="overflow-hidden rounded-lg border border-border">
                    <table className="w-full text-[13px]">
                      <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">Capability</th>
                          <th className="px-3 py-2 text-left font-semibold hidden sm:table-cell">State</th>
                          <th className="px-3 py-2 text-right font-semibold">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {caps.map((cap) => {
                          const isBulk = someSelected && selectedUserIds.size > 1
                          const userId = isBulk ? [...selectedUserIds][0] : selectedUser!.id
                          const override = overrideMap.get(`${userId}::${cap.key}`)
                          const state = isBulk
                            ? "inherited_deny"
                            : computeCellState(selectedUser!.role, cap.key, defaultsByRole, override?.effect)

                          const isInheritedAllow = !isBulk && state === "inherited_allow"
                          return (
                            <tr key={cap.key} className="border-t border-border first:border-t-0">
                              <td className="px-3 py-2.5">
                                <div className="font-medium">{cap.action.replace(/_/g, " ")}</div>
                                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                  <code>{cap.key}</code>
                                  {cap.is_admin_only && (
                                    <Badge variant="outline" className="h-4 px-1 text-[10px]">admin only</Badge>
                                  )}
                                  {override?.expires_at && (
                                    <span className="flex items-center gap-0.5 text-amber-600">
                                      <Clock className="h-3 w-3" />
                                      {new Date(override.expires_at).toLocaleDateString()}
                                    </span>
                                  )}
                                </div>
                                {cap.description && (
                                  <div className="mt-0.5 text-[11px] text-muted-foreground">{cap.description}</div>
                                )}
                              </td>
                              <td className="px-3 py-2.5 hidden sm:table-cell">
                                {isBulk
                                  ? <span className="text-[12px] text-muted-foreground italic">mixed</span>
                                  : <div className="flex items-center gap-1.5">
                                      <StateBadge state={state} />
                                      <ExplainPopover
                                        userId={userId}
                                        capKey={cap.key}
                                        role={selectedUser!.role}
                                        state={state}
                                        override={override}
                                        defaultsByRole={defaultsByRole}
                                      />
                                    </div>
                                }
                              </td>
                              <td className="px-3 py-2.5">
                                <div className="flex items-center justify-end gap-1">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant={!isBulk && state === "override_allow" ? "default" : "outline"}
                                    disabled={pending || cap.is_admin_only || isInheritedAllow}
                                    onClick={() => isBulk
                                      ? openBulkDialog(cap.key)
                                      : openOverrideDialog([selectedUser!.id], cap.key)
                                    }
                                    className="h-7 px-2 text-[12px]"
                                    title={
                                      isInheritedAllow
                                        ? "Already granted via role default"
                                        : "Set override"
                                    }
                                  >
                                    <Shield className="h-3 w-3" />
                                    {isBulk ? "Override" : "Edit"}
                                  </Button>
                                  {!isBulk && state === "override_allow" && (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      disabled={pending}
                                      onClick={() => {
                                        start(async () => {
                                          await setUserPermissionOverride({
                                            user_id: selectedUser!.id,
                                            capability_key: cap.key,
                                            effect: "clear",
                                          })
                                          router.refresh()
                                        })
                                      }}
                                      className="h-7 w-7 p-0 text-muted-foreground"
                                      title="Clear override"
                                    >
                                      <RotateCcw className="h-3 w-3" />
                                    </Button>
                                  )}
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
              {filteredGrouped.length === 0 && (
                <div className="py-8 text-center text-[13px] text-muted-foreground">No capabilities match filters.</div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* ── Override dialog ──────────────────────────────────────────────── */}
      <Dialog open={!!overrideTarget} onOpenChange={(o) => !o && closeOverrideDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {overrideTarget && overrideTarget.userIds.length > 1
                ? `Bulk override — ${overrideTarget.userIds.length} users`
                : "Set permission override"}
            </DialogTitle>
            <DialogDescription>
              {overrideTarget && (
                <>Capability: <code className="text-[12px]">{overrideTarget.capKey}</code></>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[13px]">Effect</Label>
              <div className="flex gap-2">
                {(["allow", "clear"] as const).map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setOverrideEffect(e)}
                    className={cn(
                      "flex-1 rounded-md border px-3 py-1.5 text-[13px] font-medium capitalize transition-colors",
                      overrideEffect === e
                        ? e === "allow"
                          ? "border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                          : "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-foreground/30",
                    )}
                  >
                    {e === "clear" ? "Clear (use default)" : e}
                  </button>
                ))}
              </div>
            </div>

            {overrideEffect !== "clear" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="override-reason" className="text-[13px]">Reason <span className="text-muted-foreground">(optional)</span></Label>
                  <Textarea
                    id="override-reason"
                    placeholder="Why is this override needed?"
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    rows={2}
                    className="text-[13px]"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="override-expiry" className="text-[13px]">
                    Expires on <span className="text-muted-foreground">(optional — leave blank for no expiry)</span>
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="override-expiry"
                      type="date"
                      value={overrideExpiry}
                      min={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => setOverrideExpiry(e.target.value)}
                      className="h-8 text-[13px]"
                    />
                    {overrideExpiry && (
                      <button type="button" onClick={() => setOverrideExpiry("")} className="text-muted-foreground hover:text-foreground">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  {overrideExpiry && (
                    <p className="flex items-center gap-1 text-[11px] text-amber-600">
                      <Clock className="h-3 w-3" />
                      Override will automatically expire on {new Date(overrideExpiry + "T00:00:00").toLocaleDateString()}
                    </p>
                  )}
                </div>
              </>
            )}

            {overrideError && (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
                {overrideError}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeOverrideDialog} disabled={overrideSaving}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSaveOverride}
              disabled={overrideSaving}
            >
              {overrideSaving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── History sheet ────────────────────────────────────────────────── */}
      <Sheet open={!!historyUserId} onOpenChange={(o) => !o && setHistoryUserId(null)}>
        <SheetContent className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Permission history</SheetTitle>
            {historyUserId && (
              <p className="text-[12px] text-muted-foreground">
                {users.find((u) => u.id === historyUserId)?.full_name ??
                  users.find((u) => u.id === historyUserId)?.email}
              </p>
            )}
          </SheetHeader>

          <ScrollArea className="mt-4 h-[calc(100vh-120px)]">
            {historyLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : historyEntries.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-muted-foreground">No history found.</p>
            ) : (
              <ul className="space-y-2 pr-2">
                {historyEntries.map((e) => (
                  <li key={e.id} className="rounded-lg border border-border px-3 py-2.5 text-[12px]">
                    <div className="flex items-center justify-between gap-2">
                      <code className="font-medium text-foreground">{e.capability}</code>
                      <ActionBadge action={e.action} />
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      {new Date(e.changed_at).toLocaleString()}
                      {e.granted_by_name && <> · by <strong className="text-foreground">{e.granted_by_name}</strong></>}
                      {e.expires_at && <> · expires {new Date(e.expires_at).toLocaleDateString()}</>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  )
}

function ActionBadge({ action }: { action: PermissionHistoryEntry["action"] }) {
  switch (action) {
    case "set_allow":
      return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-300">Allowed</Badge>
    case "set_deny":
      return <Badge className="bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-900/40 dark:text-red-300">Denied</Badge>
    case "cleared":
      return <Badge variant="outline" className="text-muted-foreground">Cleared</Badge>
  }
}
