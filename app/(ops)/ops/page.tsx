"use client"

import { useState } from "react"
import Link from "next/link"
import { StatusCards } from "@/components/ops/status-cards"
import { BackupPanel } from "@/components/ops/backup-panel"
import { BackupHistoryTable } from "@/components/ops/backup-history-table"

export default function OpsPage() {
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-sm text-zinc-500 mt-1">System status and database backup management.</p>
      </div>

      <StatusCards />

      <BackupPanel onBackupComplete={() => setRefreshKey((k) => k + 1)} />

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-white">Recent Backups</h2>
          <Link
            href="/ops/backups"
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            View all →
          </Link>
        </div>
        <BackupHistoryTable limit={5} refreshKey={refreshKey} />
      </div>
    </div>
  )
}
