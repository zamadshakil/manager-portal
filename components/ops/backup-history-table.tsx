"use client"

import { useCallback, useEffect, useState } from "react"
import { RestoreDialog } from "./restore-dialog"

interface BackupItem {
  key: string
  size: number
  lastModified: string
  filename: string
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

interface Props {
  limit?: number
  refreshKey?: number
}

export function BackupHistoryTable({ limit, refreshKey }: Props) {
  const [backups, setBackups] = useState<BackupItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<BackupItem | null>(null)
  const [restoreSuccess, setRestoreSuccess] = useState<string | null>(null)
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null)

  async function handleDownload(b: BackupItem) {
    setDownloadingKey(b.key)
    try {
      const res = await fetch(`/api/ops/backup/download?key=${encodeURIComponent(b.key)}`)
      if (!res.ok) {
        const data = await res.json()
        alert(data.error ?? "Download failed")
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = b.filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert("Download failed")
    } finally {
      setDownloadingKey(null)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/ops/backups")
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to load")
      const items: BackupItem[] = data.backups.map((b: any) => ({
        ...b,
        lastModified: typeof b.lastModified === "string" ? b.lastModified : new Date(b.lastModified).toISOString(),
      }))
      setBackups(limit ? items.slice(0, limit) : items)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [limit])

  useEffect(() => { load() }, [load, refreshKey])

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-12 rounded-lg bg-zinc-800/50 animate-pulse" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
        {error}
      </div>
    )
  }

  if (backups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-700 px-6 py-10 text-center">
        <p className="text-sm text-zinc-500">No backups yet. Click &ldquo;Backup Now&rdquo; to create your first.</p>
      </div>
    )
  }

  return (
    <>
      {restoreSuccess && (
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-sm text-emerald-400 flex items-center gap-2 mb-4">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          {restoreSuccess}
        </div>
      )}

      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/80">
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Backup</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Date</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Size</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {backups.map((b, i) => (
              <tr key={b.key} className="bg-zinc-900 hover:bg-zinc-800/50 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {i === 0 && (
                      <span className="text-[10px] font-semibold bg-orange-500/15 text-orange-400 px-1.5 py-0.5 rounded-full">
                        latest
                      </span>
                    )}
                    <span className="font-mono text-xs text-zinc-300 truncate max-w-[240px]">{b.filename}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-zinc-400 whitespace-nowrap">
                  {new Date(b.lastModified).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-zinc-400 whitespace-nowrap">
                  {formatBytes(b.size)}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex items-center gap-2">
                    <button
                      onClick={() => handleDownload(b)}
                      disabled={downloadingKey === b.key}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium text-zinc-300 hover:text-white transition-colors"
                    >
                      {downloadingKey === b.key ? (
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                      )}
                      {downloadingKey === b.key ? "Downloading…" : "Download"}
                    </button>
                    <button
                      onClick={() => { setRestoreTarget(b); setRestoreSuccess(null) }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-300 hover:text-white transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Restore
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {restoreTarget && (
        <RestoreDialog
          backup={restoreTarget}
          onClose={() => setRestoreTarget(null)}
          onRestored={() => {
            setRestoreTarget(null)
            setRestoreSuccess(`Restore from ${restoreTarget.filename} completed successfully.`)
            load()
          }}
        />
      )}
    </>
  )
}
