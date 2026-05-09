"use client"

import { useState } from "react"

interface BackupItem {
  key: string
  size: number
  lastModified: string
  filename: string
}

interface Props {
  backup: BackupItem
  onClose: () => void
  onRestored: () => void
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export function RestoreDialog({ backup, onClose, onRestored }: Props) {
  const [confirmed, setConfirmed] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRestore() {
    if (!confirmed || running) return
    setRunning(true)
    setError(null)
    try {
      const res = await fetch("/api/ops/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: backup.key }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Restore failed")
      onRestored()
    } catch (err: any) {
      setError(err.message ?? "Unknown error")
      setRunning(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={!running ? onClose : undefined} />
      <div className="relative w-full max-w-md rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.834-1.732-.834-2.502 0L4.268 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-white">Restore Database</h3>
              <p className="text-xs text-zinc-500 mt-0.5">This will overwrite all current data</p>
            </div>
          </div>

          <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/40 p-4 mb-5 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-500">Backup file</span>
              <span className="text-white font-mono text-xs">{backup.filename}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Created</span>
              <span className="text-white">{new Date(backup.lastModified).toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Size</span>
              <span className="text-white">{formatBytes(backup.size)}</span>
            </div>
          </div>

          <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 mb-5 text-xs text-red-300 leading-relaxed">
            <strong className="text-red-400">Warning:</strong> This will <strong>TRUNCATE ALL TABLES</strong> and replace all data with the backup.
            Foreign key checks are disabled during restore. All sequences will be reset.
            This action <strong>cannot be undone</strong>.
          </div>

          <label className="flex items-start gap-3 cursor-pointer mb-5 select-none">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={running}
              className="mt-0.5 w-4 h-4 rounded border-zinc-600 bg-zinc-800 checked:bg-red-500 checked:border-red-500 cursor-pointer"
            />
            <span className="text-sm text-zinc-300">
              I understand this will <strong className="text-white">permanently overwrite</strong> all current database data.
            </span>
          </label>

          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5 mb-4 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={running}
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleRestore}
              disabled={!confirmed || running}
              className="flex-1 rounded-lg bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-white transition-colors flex items-center justify-center gap-2"
            >
              {running ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Restoring…
                </>
              ) : (
                "Confirm Restore"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
