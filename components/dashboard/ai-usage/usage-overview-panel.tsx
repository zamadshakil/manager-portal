"use client"

import { useMemo, useState, useEffect } from "react"
import { TrendingUp, Users, Zap, AlertTriangle, BarChart2, Activity } from "lucide-react"
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts"
import type { AiCreditLimit } from "@/lib/types"
import { createClient } from "@/lib/supabase/client"

interface Props {
  creditLimits: AiCreditLimit[]
  usageTrend: Array<{ day: string; count: number }>
  totalMessages: number
}

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  accent,
}: {
  title: string
  value: string | number
  subtitle: string
  icon: React.ComponentType<{ className?: string }>
  accent: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{title}</span>
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${accent}`}>
          <Icon className="h-4 w-4 text-white" />
        </div>
      </div>
      <div>
        <p className="text-3xl font-bold tracking-tight">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      </div>
    </div>
  )
}

export function UsageOverviewPanel({ creditLimits: initialCreditLimits, usageTrend: initialUsageTrend, totalMessages: initialTotalMessages }: Props) {
  const [creditLimits, setCreditLimits] = useState(initialCreditLimits)
  const [usageTrend, setUsageTrend] = useState(initialUsageTrend)
  const [totalMessages, setTotalMessages] = useState(initialTotalMessages)
  const [chartType, setChartType] = useState<"area" | "bar">("bar")

  useEffect(() => {
    setCreditLimits(initialCreditLimits)
    setUsageTrend(initialUsageTrend)
    setTotalMessages(initialTotalMessages)
  }, [initialCreditLimits, initialUsageTrend, initialTotalMessages])

  useEffect(() => {
    const supabase = createClient()
    
    // Listen for credit limit changes (usage per user)
    const creditsChannel = supabase
      .channel("overview-credits-realtime")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "ai_credit_limits" },
        (payload) => {
          const updated = payload.new as any
          setCreditLimits((prev) => {
            const index = prev.findIndex((r) => r.user_id === updated.user_id)
            if (index === -1) return prev
            const next = [...prev]
            next[index] = { ...next[index], ...updated }
            return next
          })
        }
      )
      .subscribe()

    // Listen for new usage logs (overall trend)
    const logsChannel = supabase
      .channel("overview-logs-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "ai_usage_log" },
        (payload) => {
          const newLog = payload.new as any
          const today = new Date().toISOString().slice(0, 10)
          // Increment the total messages counter (1 per log entry)
          setTotalMessages((prev) => prev + 1)
          
          setUsageTrend((prev) => {
            const index = prev.findIndex((d) => d.day === today)
            if (index === -1) {
              return [...prev, { day: today, count: 1 }].slice(-30)
            }
            const next = [...prev]
            next[index] = { ...next[index], count: next[index].count + 1 }
            return next
          })
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(creditsChannel)
      void supabase.removeChannel(logsChannel)
    }
  }, [])

  const stats = useMemo(() => {
    const activeUsers = creditLimits.filter((u) => u.used_this_period > 0).length
    const withLimits = creditLimits.filter((u) => !u.is_unlimited && u.monthly_limit > 0)
    const avgPct =
      withLimits.length > 0
        ? Math.round(
            withLimits.reduce(
              (s, u) => s + (u.used_this_period / u.monthly_limit) * 100,
              0,
            ) / withLimits.length,
          )
        : 0
    const nearLimit = creditLimits.filter(
      (u) =>
        !u.is_unlimited &&
        u.monthly_limit > 0 &&
        u.used_this_period / u.monthly_limit >= 0.9,
    ).length
    return { activeUsers, avgPct, nearLimit }
  }, [creditLimits])

  // Top consumers sorted by used_this_period desc
  const topConsumers = useMemo(
    () =>
      [...creditLimits]
        .sort((a, b) => b.used_this_period - a.used_this_period)
        .slice(0, 8),
    [creditLimits],
  )

  // Format date labels for chart
  const chartData = useMemo(() => {
    return usageTrend.map((d) => {
      // Use explicit UTC components to avoid timezone shifts in labels
      const [y, m, day] = d.day.split("-").map(Number)
      const date = new Date(Date.UTC(y, m - 1, day))
      return {
        ...d,
        label: date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        }),
      }
    })
  }, [usageTrend])

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Messages This Period"
          value={totalMessages.toLocaleString()}
          subtitle="Across all users"
          icon={TrendingUp}
          accent="bg-violet-500"
        />
        <StatCard
          title="Active AI Users"
          value={stats.activeUsers}
          subtitle="Sent ≥1 message this period"
          icon={Users}
          accent="bg-indigo-500"
        />
        <StatCard
          title="Avg Credits Used"
          value={`${stats.avgPct}%`}
          subtitle="Of monthly/period limit"
          icon={Zap}
          accent="bg-sky-500"
        />
        <StatCard
          title="Near Limit"
          value={stats.nearLimit}
          subtitle="Users at ≥90% usage"
          icon={AlertTriangle}
          accent={stats.nearLimit > 0 ? "bg-amber-500" : "bg-emerald-500"}
        />
      </div>

      {/* Chart card */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold">AI Messages — Last 30 Days</h2>
          <div className="flex items-center gap-1 rounded-lg border border-border p-0.5 text-xs">
            <button
              onClick={() => setChartType("area")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors ${
                chartType === "area"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Activity className="h-3 w-3" />
              Area
            </button>
            <button
              onClick={() => setChartType("bar")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors ${
                chartType === "bar"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <BarChart2 className="h-3 w-3" />
              Bar
            </button>
          </div>
        </div>
        {usageTrend.every((d) => d.count === 0) ? (
          <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
            No AI usage recorded yet.
          </div>
        ) : chartType === "area" ? (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={chartData} margin={{ top: 8, right: 16, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                interval={4}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 10,
                  fontSize: 12,
                  boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
                }}
                labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 700, marginBottom: 2 }}
                itemStyle={{ color: "hsl(var(--primary))" }}
                cursor={{ stroke: "hsl(var(--primary))", strokeWidth: 1, strokeDasharray: "4 4" }}
              />
              <Area
                type="monotone"
                dataKey="count"
                name="Messages"
                stroke="hsl(var(--primary))"
                strokeWidth={2.5}
                fill="url(#areaGradient)"
                dot={{ r: 4, fill: "hsl(var(--primary))", strokeWidth: 2, stroke: "hsl(var(--card))" }}
                activeDot={{ r: 6, fill: "hsl(var(--primary))", stroke: "hsl(var(--card))", strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} margin={{ top: 8, right: 16, left: -20, bottom: 0 }} barCategoryGap="30%">
              <defs>
                <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={1} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                interval={4}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 10,
                  fontSize: 12,
                  boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
                }}
                labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 700, marginBottom: 2 }}
                itemStyle={{ color: "hsl(var(--primary))" }}
                cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
              />
              <Bar
                dataKey="count"
                name="Messages"
                fill="url(#barGradient)"
                radius={[4, 4, 0, 0]}
                maxBarSize={48}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Top consumers table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Top Consumers This Period</h2>
        </div>
        <div className="divide-y divide-border">
          {topConsumers.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">
              No usage data yet.
            </div>
          ) : (
            topConsumers.map((u) => {
              const pct = u.is_unlimited
                ? 0
                : u.monthly_limit > 0
                ? Math.round((u.used_this_period / u.monthly_limit) * 100)
                : 0
              const barColor =
                pct >= 90
                  ? "bg-red-500"
                  : pct >= 50
                  ? "bg-amber-500"
                  : "bg-emerald-500"
              return (
                <div
                  key={u.user_id}
                  className="flex items-center gap-4 px-5 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {u.user_full_name ?? u.user_email ?? "Unknown"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {u.user_role} {u.user_team_name ? `· ${u.user_team_name}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-medium tabular-nums">
                      {u.used_this_period}
                      <span className="text-muted-foreground font-normal">
                        {u.is_unlimited ? " / ∞" : ` / ${u.monthly_limit}`}
                      </span>
                    </p>
                    <p className="text-xs capitalize text-muted-foreground">{u.period_type}</p>
                  </div>
                  <div className="w-24 shrink-0">
                    {u.is_unlimited ? (
                      <span className="text-xs text-indigo-500 font-medium">Unlimited</span>
                    ) : (
                      <div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${barColor}`}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5 text-right">
                          {pct}%
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
