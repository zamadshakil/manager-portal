"use client"

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts"
import type { StatusBreakdown } from "@/lib/system"

interface StatusChartProps {
  data: StatusBreakdown[]
  total: number
}

export function StatusChart({ data, total }: StatusChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-[13px] text-muted-foreground">
        No requests yet
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center">
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={3}
            dataKey="count"
            nameKey="label"
          >
            {data.map((entry) => (
              <Cell key={entry.label} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              fontSize: 12,
            }}
            formatter={(value: number, name: string) => [
              `${value.toLocaleString()} (${total > 0 ? ((value / total) * 100).toFixed(1) : 0}%)`,
              name,
            ]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
        </PieChart>
      </ResponsiveContainer>
      <p className="text-[11px] text-muted-foreground -mt-2">
        {total.toLocaleString()} total requests (24h)
      </p>
    </div>
  )
}
