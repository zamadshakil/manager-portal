import { Pool, PoolClient } from "pg"
import { unzipSync } from "fflate"
import { downloadBackup } from "@/lib/ops/storage"

function getPool(): Pool {
  const url = process.env.POSTGRES_PRIVATE_URL || process.env.DATABASE_URL
  if (!url) throw new Error("No Postgres URL configured (POSTGRES_PRIVATE_URL or DATABASE_URL)")
  return new Pool({ connectionString: url, max: 1 })
}

const BATCH_SIZE = 500

interface Manifest {
  version: number
  timestamp: string
  tables: string[]
  row_counts: Record<string, number>
  total_rows: number
}

export interface RestoreResult {
  tables_restored: number
  rows_restored: number
  duration_ms: number
}

async function insertBatch(
  client: PoolClient,
  table: string,
  rows: Record<string, unknown>[]
): Promise<void> {
  if (rows.length === 0) return
  const columns = Object.keys(rows[0])
  if (columns.length === 0) return

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const colList = columns.map((c) => `"${c}"`).join(", ")
    const valuePlaceholders = batch
      .map(
        (_, ri) =>
          `(${columns.map((_, ci) => `$${ri * columns.length + ci + 1}`).join(", ")})`
      )
      .join(", ")
    const flatValues = batch.flatMap((row) => columns.map((c) => row[c] ?? null))
    await client.query(
      `INSERT INTO public."${table}" (${colList}) VALUES ${valuePlaceholders}`,
      flatValues
    )
  }
}

export async function runRestore(key: string): Promise<RestoreResult> {
  const start = Date.now()
  const zipBuffer = await downloadBackup(key)
  const zipUint8 = new Uint8Array(zipBuffer)
  const files = unzipSync(zipUint8)

  const manifestRaw = files["manifest.json"]
  if (!manifestRaw) throw new Error("manifest.json not found in backup zip")
  const manifest: Manifest = JSON.parse(Buffer.from(manifestRaw).toString("utf8"))

  const pool = getPool()
  const client = await pool.connect()

  try {
    await client.query("BEGIN")
    await client.query("SET session_replication_role = replica")

    for (const table of manifest.tables) {
      await client.query(`TRUNCATE public."${table}" CASCADE`)
    }

    let totalRowsRestored = 0
    for (const table of manifest.tables) {
      const fileKey = `public.${table}.json`
      const raw = files[fileKey]
      if (!raw) continue
      const rows: Record<string, unknown>[] = JSON.parse(
        Buffer.from(raw).toString("utf8")
      )
      await insertBatch(client, table, rows)
      totalRowsRestored += rows.length
    }

    await client.query("SET session_replication_role = DEFAULT")

    const seqRes = await client.query<{ seq: string; col: string; tbl: string }>(`
      SELECT
        pg_get_serial_sequence(quote_ident(t.table_name), c.column_name) AS seq,
        c.column_name AS col,
        t.table_name AS tbl
      FROM information_schema.tables t
      JOIN information_schema.columns c ON c.table_name = t.table_name
        AND c.table_schema = t.table_schema
      WHERE t.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
        AND c.column_default LIKE 'nextval%'
    `)

    for (const { seq, col, tbl } of seqRes.rows) {
      if (!seq) continue
      await client.query(
        `SELECT setval($1, COALESCE((SELECT MAX("${col}") FROM public."${tbl}"), 1))`,
        [seq]
      )
    }

    await client.query("COMMIT")

    return {
      tables_restored: manifest.tables.length,
      rows_restored: totalRowsRestored,
      duration_ms: Date.now() - start,
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}
