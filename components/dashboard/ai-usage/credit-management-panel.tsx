"use client"

import { useState, useTransition, useMemo, useEffect } from "react"
import { Search, RotateCcw, Edit2, History, Check, X } from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { AiCreditLimit, AiCreditPeriod } from "@/lib/types"
import { resetUserCredits, bulkSetDefaultLimit } from "@/app/actions/ai-credits"
import { CreditEditDialog } from "./credit-edit-dialog"
import { createClient } from "@/lib/supabase/client"

interface Props {
  creditLimits: AiCreditLimit[]
}

const PERIOD_COLORS: Record<AiCreditPeriod, string> = {
  daily: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  weekly: "bg-violet-500/10 text-violet-600 border-violet-500/20",
  monthly: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20",
}

export function CreditManagementPanel({ creditLimits: initialCreditLimits }: Props) {
  const [search, setSearch] = useState("")
  const [filterPeriod, setFilterPeriod] = useState<AiCreditPeriod | "all">("all")
  const [editTarget, setEditTarget] = useState<AiCreditLimit | null>(null)
  const [resetingId, setResetingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Bulk default state
  const [bulkLimit, setBulkLimit] = useState("100")
  const [bulkPeriod, setBulkPeriod] = useState<AiCreditPeriod>("monthly")
  const [bulkPending, startBulkTransition] = useTransition()

  // Real-time synchronization
  const [rows, setRows] = useState(initialCreditLimits)

  useEffect(() => {
    setRows(initialCreditLimits)
  }, [initialCreditLimits])

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel("credits-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ai_credit_limits" },
        async (payload) => {
          const updated = payload.new as any
          if (!updated?.user_id) return

          setRows((prev) => {
            const index = prev.findIndex((r) => r.user_id === updated.user_id)
            if (index === -1) {
              // This is a new user row, but we lack the profile join info.
              // In this case, we could either fetch the profile or just wait for a refresh.
              // For robustness, let's fetch the profile if it's a new row.
              // But usually rows exist before usage. 
              // Let's just update the usage if the row exists.
              return prev
            }

            const next = [...prev]
            next[index] = {
              ...next[index],
              ...updated,
            }
            return next
          })
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return rows.filter((u) => {
      const matchSearch =
        !q ||
        (u.user_full_name ?? "").toLowerCase().includes(q) ||
        (u.user_email ?? "").toLowerCase().includes(q) ||
        (u.user_team_name ?? "").toLowerCase().includes(q)
      const matchPeriod = filterPeriod === "all" || u.period_type === filterPeriod
      return matchSearch && matchPeriod
    })
  }, [initialCreditLimits, search, filterPeriod, rows])

  function handleReset(user: AiCreditLimit) {
    setResetingId(user.user_id)
    startTransition(async () => {
      const res = await resetUserCredits(user.user_id)
      if (res.ok) {
        toast.success(`Credits reset for ${user.user_full_name ?? user.user_email}`)
      } else {
        toast.error(res.error ?? "Reset failed")
      }
      setResetingId(null)
    })
  }

  function handleBulkSet() {
    const lim = parseInt(bulkLimit, 10)
    if (isNaN(lim) || lim < 1) {
      toast.error("Please enter a valid limit (≥ 1)")
      return
    }
    startBulkTransition(async () => {
      const res = await bulkSetDefaultLimit({ limit: lim, periodType: bulkPeriod })
      if (res.ok) {
        toast.success(
          res.inserted > 0
            ? `Default applied to ${res.inserted} user${res.inserted !== 1 ? "s" : ""}`
            : "All users already have a credit row — no changes made.",
        )
      } else {
        toast.error(res.error ?? "Bulk set failed")
      }
    })
  }

  return (
    <div className="space-y-5">
      {/* Bulk default setter */}
      <div className="rounded-xl border border-border bg-card p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">
            Bulk Default Limit
          </label>
          <Input
            type="number"
            min={1}
            value={bulkLimit}
            onChange={(e) => setBulkLimit(e.target.value)}
            className="w-28 h-8 text-sm"
            placeholder="100"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">
            Period Type
          </label>
          <div className="flex gap-1">
            {(["daily", "weekly", "monthly"] as AiCreditPeriod[]).map((p) => (
              <button
                key={p}
                onClick={() => setBulkPeriod(p)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors capitalize ${
                  bulkPeriod === p
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleBulkSet}
          disabled={bulkPending}
          className="h-8"
        >
          {bulkPending ? "Applying…" : "Apply to new users"}
        </Button>
        <p className="text-xs text-muted-foreground self-end">
          Only affects users without an existing credit row.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, or team…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <div className="flex gap-1">
          {(["all", "daily", "weekly", "monthly"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setFilterPeriod(p)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors capitalize ${
                filterPeriod === p
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {p === "all" ? "All periods" : p}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">User</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Role</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Team</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Period</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Used / Limit</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground w-32">Usage</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Resets</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground">Unlimited</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No users found.
                  </td>
                </tr>
              ) : (
                filtered.map((u) => {
                  const pct =
                    u.is_unlimited || u.monthly_limit === 0
                      ? 0
                      : Math.round((u.used_this_period / u.monthly_limit) * 100)
                  const barColor =
                    pct >= 90
                      ? "bg-red-500"
                      : pct >= 50
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                  const isReseting = resetingId === u.user_id && isPending

                  return (
                    <tr key={u.user_id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium truncate max-w-[180px]">
                          {u.user_full_name ?? "—"}
                        </p>
                        <p className="text-xs text-muted-foreground truncate max-w-[180px]">
                          {u.user_email}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="capitalize text-xs">{u.user_role?.replace("_", " ")}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-muted-foreground">
                          {u.user_team_name ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border capitalize ${PERIOD_COLORS[u.period_type]}`}
                        >
                          {u.period_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-xs">
                        {u.used_this_period}
                        <span className="text-muted-foreground">
                          {" / "}
                          {u.is_unlimited ? "∞" : u.monthly_limit}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {u.is_unlimited ? (
                          <span className="text-xs text-indigo-500 font-medium">Unlimited</span>
                        ) : (
                          <div>
                            <div className="h-1.5 w-28 rounded-full bg-muted overflow-hidden">
                              <div
                                className={`h-full rounded-full ${barColor}`}
                                style={{ width: `${Math.min(100, pct)}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-muted-foreground">{pct}%</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {u.period_end
                          ? new Date(u.period_end + "T00:00:00").toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {u.is_unlimited ? (
                          <Check className="h-4 w-4 text-emerald-500 mx-auto" />
                        ) : (
                          <X className="h-4 w-4 text-muted-foreground mx-auto" />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Edit credit limit"
                            onClick={() => setEditTarget(u)}
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            title="Reset usage to 0"
                            onClick={() => handleReset(u)}
                            disabled={isReseting}
                          >
                            <RotateCcw className={`h-3.5 w-3.5 ${isReseting ? "animate-spin" : ""}`} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {filtered.length > 0 && (
          <div className="px-4 py-2 border-t border-border text-xs text-muted-foreground">
            Showing {filtered.length} of {rows.length} users
          </div>
        )}
      </div>

      {/* Edit dialog */}
      {editTarget && (
        <CreditEditDialog
          user={editTarget}
          open={!!editTarget}
          onClose={() => setEditTarget(null)}
        />
      )}
    </div>
  )
}
