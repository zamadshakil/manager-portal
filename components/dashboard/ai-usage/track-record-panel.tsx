"use client"

import { useState, useTransition, useCallback } from "react"
import { Search, ExternalLink, Loader2 } from "lucide-react"
import Link from "next/link"
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts"
import { Input } from "@/components/ui/input"
import type { AiCreditLimit, AiUsageLogEntry } from "@/lib/types"
import { getUserUsageHistory, getUserDailyTrend } from "@/app/actions/ai-credits"

interface Props {
  creditLimits: AiCreditLimit[]
}

interface UserHistory {
  log: AiUsageLogEntry[]
  trend: Array<{ day: string; count: number }>
}

export function TrackRecordPanel({ creditLimits }: Props) {
  const [search, setSearch] = useState("")
  const [selectedUser, setSelectedUser] = useState<AiCreditLimit | null>(null)
  const [history, setHistory] = useState<UserHistory | null>(null)
  const [isPending, startTransition] = useTransition()

  const filteredUsers = creditLimits.filter((u) => {
    const q = search.toLowerCase()
    return (
      !q ||
      (u.user_full_name ?? "").toLowerCase().includes(q) ||
      (u.user_email ?? "").toLowerCase().includes(q) ||
      (u.user_team_name ?? "").toLowerCase().includes(q)
    )
  })

  const loadHistory = useCallback((user: AiCreditLimit) => {
    setSelectedUser(user)
    setHistory(null)
    startTransition(async () => {
      const [log, trend] = await Promise.all([
        getUserUsageHistory(user.user_id, 30),
        getUserDailyTrend(user.user_id, 30),
      ])
      setHistory({ log, trend })
    })
  }, [])

  const totalTokensIn = history?.log.reduce((s, r) => s + (r.tokens_in ?? 0), 0) ?? 0
  const totalTokensOut = history?.log.reduce((s, r) => s + (r.tokens_out ?? 0), 0) ?? 0
  const mostActiveDay = history?.trend.reduce(
    (best, d) => (d.count > best.count ? d : best),
    { day: "", count: 0 },
  )

  const chartData =
    history?.trend.map((d) => ({
      ...d,
      label: new Date(d.day + "T00:00:00").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
    })) ?? []

  return (
    <div className="grid lg:grid-cols-[280px_1fr] gap-5 items-start">
      {/* Left: user list */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search users…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
        </div>
        <div className="divide-y divide-border max-h-[520px] overflow-y-auto">
          {filteredUsers.length === 0 && (
            <p className="px-4 py-6 text-sm text-center text-muted-foreground">No users found.</p>
          )}
          {filteredUsers.map((u) => (
            <button
              key={u.user_id}
              onClick={() => loadHistory(u)}
              className={`w-full text-left px-4 py-3 transition-colors hover:bg-muted/50 ${
                selectedUser?.user_id === u.user_id ? "bg-muted/70" : ""
              }`}
            >
              <p className="text-sm font-medium truncate">
                {u.user_full_name ?? u.user_email ?? "Unknown"}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] capitalize text-muted-foreground">
                  {u.user_role?.replace("_", " ")}
                </span>
                {u.user_team_name && (
                  <>
                    <span className="text-muted-foreground/40 text-[10px]">·</span>
                    <span className="text-[10px] text-muted-foreground truncate">
                      {u.user_team_name}
                    </span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <div className="h-1 w-16 rounded-full bg-muted overflow-hidden">
                  {!u.is_unlimited && u.monthly_limit > 0 && (
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{
                        width: `${Math.min(100, (u.used_this_period / u.monthly_limit) * 100)}%`,
                      }}
                    />
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {u.used_this_period}
                  {!u.is_unlimited ? ` / ${u.monthly_limit}` : " / ∞"}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right: history panel */}
      <div className="space-y-5">
        {!selectedUser && (
          <div className="rounded-xl border border-dashed border-border flex items-center justify-center h-64 text-sm text-muted-foreground">
            Select a user to view their AI usage history
          </div>
        )}

        {selectedUser && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                {
                  label: "Total Messages (30d)",
                  value: isPending ? "—" : (history?.log.length ?? 0).toLocaleString(),
                },
                {
                  label: "This Period",
                  value: isPending ? "—" : selectedUser.used_this_period.toLocaleString(),
                },
                {
                  label: "Tokens In",
                  value: isPending ? "—" : totalTokensIn > 0 ? totalTokensIn.toLocaleString() : "N/A",
                },
                {
                  label: "Most Active Day",
                  value: isPending
                    ? "—"
                    : mostActiveDay && mostActiveDay.count > 0
                    ? new Date(mostActiveDay.day + "T00:00:00").toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })
                    : "—",
                },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border border-border bg-card px-4 py-3">
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                    {s.label}
                  </p>
                  <p className="text-xl font-bold mt-1">{s.value}</p>
                </div>
              ))}
            </div>

            {/* Daily bar chart */}
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold mb-4">
                Daily Usage — {selectedUser.user_full_name ?? selectedUser.user_email}
              </h3>
              {isPending ? (
                <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : chartData.every((d) => d.count === 0) ? (
                <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
                  No activity in the last 30 days.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={chartData} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                      interval={4}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="count" name="Messages" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Message log table */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <h3 className="text-sm font-semibold">Message Log (last 30 days)</h3>
                {history && (
                  <span className="text-xs text-muted-foreground">
                    {history.log.length} record{history.log.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {isPending ? (
                <div className="flex items-center justify-center py-10 gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
                </div>
              ) : history && history.log.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  No messages found in the last 30 days.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">
                          Date / Time
                        </th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">
                          Thread
                        </th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">
                          Model
                        </th>
                        <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">
                          Tokens In
                        </th>
                        <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">
                          Tokens Out
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {(history?.log ?? []).map((entry) => (
                        <tr key={entry.id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2.5 text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                            {new Date(entry.created_at).toLocaleString("en-US", {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                          <td className="px-4 py-2.5">
                            {entry.thread_id ? (
                              <Link
                                href={`/dashboard/smart-ai?thread=${entry.thread_id}`}
                                className="flex items-center gap-1 text-xs text-primary hover:underline font-mono"
                              >
                                {entry.thread_id.slice(0, 8)}…
                                <ExternalLink className="h-2.5 w-2.5" />
                              </Link>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">
                            {entry.model ?? "—"}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-right tabular-nums">
                            {entry.tokens_in != null ? entry.tokens_in.toLocaleString() : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-right tabular-nums">
                            {entry.tokens_out != null ? entry.tokens_out.toLocaleString() : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
