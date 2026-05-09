import Link from "next/link"
import { BackupHistoryTable } from "@/components/ops/backup-history-table"

export default function OpsBackupsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/ops"
          className="text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-white">Backup History</h1>
          <p className="text-sm text-zinc-500 mt-0.5">All backups stored in R2. Restore any point-in-time snapshot.</p>
        </div>
      </div>

      <BackupHistoryTable />
    </div>
  )
}
