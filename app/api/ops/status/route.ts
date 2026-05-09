import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { verifyToken } from "@/lib/ops/auth"
import { listBackups } from "@/lib/ops/storage"
import { Pool } from "pg"

export const dynamic = "force-dynamic"

async function verifySession(): Promise<boolean> {
  const jar = await cookies()
  const token = jar.get("ops_session")?.value
  if (!token) return false
  return verifyToken(token) !== null
}

async function checkDb(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
  const url = process.env.POSTGRES_PRIVATE_URL || process.env.DATABASE_URL
  if (!url) return { ok: false, latency_ms: 0, error: "No DB URL configured" }
  const pool = new Pool({ connectionString: url, max: 1 })
  const t = Date.now()
  try {
    await pool.query("SELECT 1")
    return { ok: true, latency_ms: Date.now() - t }
  } catch (err: any) {
    return { ok: false, latency_ms: Date.now() - t, error: err.message }
  } finally {
    await pool.end()
  }
}

async function checkR2(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
  const t = Date.now()
  try {
    await listBackups()
    return { ok: true, latency_ms: Date.now() - t }
  } catch (err: any) {
    return { ok: false, latency_ms: Date.now() - t, error: err.message }
  }
}

export async function GET() {
  if (!(await verifySession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const [db, r2BackupsResult] = await Promise.all([checkDb(), checkR2()])

  let lastBackup: { key: string; size: number; lastModified: string } | null = null
  let backupCount = 0
  if (r2BackupsResult.ok) {
    try {
      const backups = await listBackups()
      backupCount = backups.length
      if (backups.length > 0) {
        lastBackup = {
          key: backups[0].key,
          size: backups[0].size,
          lastModified: backups[0].lastModified.toISOString(),
        }
      }
    } catch {}
  }

  return NextResponse.json({
    db,
    r2: { ok: r2BackupsResult.ok, latency_ms: r2BackupsResult.latency_ms, error: r2BackupsResult.error },
    last_backup: lastBackup,
    backup_count: backupCount,
  })
}
