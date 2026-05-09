"use client"

import { useState } from "react"

type State = "idle" | "running" | "done" | "error"

interface BackupResult {
  key: string
  size: number
  tables: string[]
  total_rows: number
  duration_ms: number
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

interface Props {
  onBackupComplete?: () => void
}

export function BackupPanel({ onBackupComplete }: Props) {
  const [state, setState] = useState<State>("idle")
  const [result, setResult] = useState<BackupResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleBackup() {
    setState("running")
    setResult(null)
    setError(null)
    try {
      const res = await fetch("/api/ops/backup", { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Backup failed")
      setResult(data)
      setState("done")
      onBackupComplete?.()
    } catch (err: any) {
      setError(err.message ?? "Unknown error")
      setState("error")
    }
  }

  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-6">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="text-base font-semibold text-white">Create Backup</h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            Dumps all public schema tables to a zip file and uploads to R2.
          </p>
        </div>
        <button
          onClick={handleBackup}
          disabled={state === "running"}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 active:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold text-white transition-colors"
        >
          {state === "running" ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Running…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
              </svg>
              Backup Now
            </>
          )}
        </button>
      </div>

      {state === "running" && (
        <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/40 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
            <p className="text-sm text-zinc-300">
              Querying tables, serializing to JSON, compressing, uploading to R2…
            </p>
          </div>
          <div className="mt-2 h-1 rounded-full bg-zinc-700 overflow-hidden">
            <div className="h-full bg-orange-500 animate-[indeterminate_1.5s_ease-in-out_infinite] w-1/3 rounded-full" />
          </div>
        </div>
      )}

      {state === "done" && result && (
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <p className="text-sm font-semibold text-emerald-400">Backup complete</p>
          </div>
          <div className="grid grid-cols-3 gap-4 mt-2 text-xs text-zinc-400">
            <div><span className="text-zinc-500">Tables</span><br /><span className="text-white font-medium">{result.tables.length}</span></div>
            <div><span className="text-zinc-500">Rows</span><br /><span className="text-white font-medium">{result.total_rows.toLocaleString()}</span></div>
            <div><span className="text-zinc-500">Size</span><br /><span className="text-white font-medium">{formatBytes(result.size)}</span></div>
          </div>
          <p className="text-xs text-zinc-600 mt-2 font-mono truncate">{result.key}</p>
        </div>
      )}

      {state === "error" && error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-red-400">{error}</p>
          </div>
        </div>
      )}
    </div>
  )
}
