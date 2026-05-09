"use client"

import { useEffect, useState } from "react"

interface StatusData {
  db: { ok: boolean; latency_ms: number; error?: string }
  r2: { ok: boolean; latency_ms: number; error?: string }
  last_backup: { key: string; size: number; lastModified: string } | null
  backup_count: number
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

interface CardProps {
  title: string
  value: React.ReactNode
  sub?: string
  status?: "ok" | "error" | "loading"
}

function Card({ title, value, sub, status }: CardProps) {
  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-5">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{title}</p>
        {status && (
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${
              status === "ok"
                ? "bg-emerald-500/10 text-emerald-400"
                : status === "error"
                ? "bg-red-500/10 text-red-400"
                : "bg-zinc-700/40 text-zinc-500"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                status === "ok"
                  ? "bg-emerald-400"
                  : status === "error"
                  ? "bg-red-400"
                  : "bg-zinc-500"
              }`}
            />
            {status === "ok" ? "Online" : status === "error" ? "Error" : "Checking"}
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      {sub && <p className="text-xs text-zinc-500 mt-1">{sub}</p>}
    </div>
  )
}

interface StatusCardsProps {
  refreshKey?: number
}

export function StatusCards({ refreshKey }: StatusCardsProps) {
  const [data, setData] = useState<StatusData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch("/api/ops/status")
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [refreshKey])

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-xl bg-zinc-900 border border-zinc-800 p-5 animate-pulse h-28" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <Card
        title="Database"
        value={data?.db.ok ? "Connected" : "Error"}
        sub={data?.db.ok ? `${data.db.latency_ms}ms` : data?.db.error ?? "Unreachable"}
        status={data?.db.ok ? "ok" : "error"}
      />
      <Card
        title="R2 Storage"
        value={data?.r2.ok ? "Connected" : "Error"}
        sub={data?.r2.ok ? `${data.r2.latency_ms}ms` : data?.r2.error ?? "Unreachable"}
        status={data?.r2.ok ? "ok" : "error"}
      />
      <Card
        title="Last Backup"
        value={data?.last_backup ? formatRelative(data.last_backup.lastModified) : "Never"}
        sub={data?.last_backup ? formatBytes(data.last_backup.size) : undefined}
      />
      <Card
        title="Total Backups"
        value={data?.backup_count ?? 0}
        sub="stored in R2"
      />
    </div>
  )
}
