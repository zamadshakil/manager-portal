import { Pool } from "pg"
import { zipSync } from "fflate"
import { putRaw } from "@/lib/r2"

function getPool(): Pool {
  const url = process.env.POSTGRES_PRIVATE_URL || process.env.DATABASE_URL
  if (!url) throw new Error("No Postgres URL configured (POSTGRES_PRIVATE_URL or DATABASE_URL)")
  return new Pool({ connectionString: url, max: 1 })
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19)
}

export interface BackupResult {
  key: string
  size: number
  tables: string[]
  total_rows: number
  duration_ms: number
}

export async function runBackup(): Promise<BackupResult> {
  const start = Date.now()
  const pool = getPool()
  const client = await pool.connect()

  try {
    const tablesRes = await client.query<{ tablename: string }>(
      `SELECT tablename FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_type = 'BASE TABLE'
       ORDER BY tablename`
    )
    const tables = tablesRes.rows.map((r) => r.tablename)

    const files: Record<string, Uint8Array> = {}
    const rowCounts: Record<string, number> = {}
    let totalRows = 0

    for (const table of tables) {
      const res = await client.query(`SELECT * FROM public."${table}"`)
      rowCounts[table] = res.rowCount ?? res.rows.length
      totalRows += rowCounts[table]
      files[`public.${table}.json`] = Buffer.from(JSON.stringify(res.rows))
    }

    const manifest = {
      version: 1,
      timestamp: new Date().toISOString(),
      tables,
      row_counts: rowCounts,
      total_rows: totalRows,
    }
    files["manifest.json"] = Buffer.from(JSON.stringify(manifest, null, 2))

    const zipped = zipSync(files, { level: 6 })
    const buffer = Buffer.from(zipped)

    const ts = timestamp()
    const key = `backups/db/backup_${ts}.zip`

    await putRaw(key, buffer, "application/zip")

    return {
      key,
      size: buffer.length,
      tables,
      total_rows: totalRows,
      duration_ms: Date.now() - start,
    }
  } finally {
    client.release()
    await pool.end()
  }
}
