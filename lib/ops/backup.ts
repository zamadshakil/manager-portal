import { Pool } from "pg"
import { Zip, ZipDeflate } from "fflate"
import { putRaw } from "@/lib/r2"
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3"

/** R2 key prefixes whose files are included in every full backup. */
const FILE_PREFIXES = ["materials/", "submissions/", "messaging/", "avatars/"]

function getPool(): Pool {
  const url = process.env.POSTGRES_PRIVATE_URL || process.env.DATABASE_URL
  if (!url) throw new Error("No Postgres URL configured (POSTGRES_PRIVATE_URL or DATABASE_URL)")
  return new Pool({ connectionString: url, max: 1 })
}

function getR2Client(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    },
    forcePathStyle: true,
  })
}

const BUCKET = () => process.env.R2_BUCKET_NAME || ""

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19)
}

export interface BackupResult {
  key: string
  size: number
  tables: string[]
  total_rows: number
  files_count: number
  files_size_bytes: number
  duration_ms: number
}

interface R2FileEntry {
  key: string
  size: number
}

/** List every R2 object under the given prefixes, paginating automatically. */
async function listAllR2Files(r2: S3Client, prefixes: string[]): Promise<R2FileEntry[]> {
  const all: R2FileEntry[] = []
  for (const prefix of prefixes) {
    let continuationToken: string | undefined
    do {
      const res = await r2.send(
        new ListObjectsV2Command({
          Bucket: BUCKET(),
          Prefix: prefix,
          MaxKeys: 1000,
          ContinuationToken: continuationToken,
        })
      )
      for (const obj of res.Contents ?? []) {
        if (obj.Key && obj.Key !== prefix) {
          all.push({ key: obj.Key, size: obj.Size ?? 0 })
        }
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
    } while (continuationToken)
  }
  return all
}

/** Download a single R2 object by key and return its bytes. */
async function downloadR2File(r2: S3Client, key: string): Promise<Buffer> {
  const res = await r2.send(new GetObjectCommand({ Bucket: BUCKET(), Key: key }))
  const body = res.Body as any
  if (!body) throw new Error(`Empty body for R2 key: ${key}`)
  const chunks: Uint8Array[] = []
  for await (const chunk of body) chunks.push(chunk)
  return Buffer.concat(chunks)
}

interface ZipEntry {
  name: string
  data: Buffer
  binary?: boolean
}

/**
 * Build a zip archive from the given entries using fflate's streaming Zip API.
 * Text entries (binary=false) are deflated at level 6; binary entries use
 * store (level 0) to avoid wasting CPU on already-compressed data.
 */
function buildZip(entries: ZipEntry[]): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const outputChunks: Buffer[] = []
    const zip = new Zip((err, chunk, final) => {
      if (err) { reject(err); return }
      outputChunks.push(Buffer.from(chunk))
      if (final) resolve(Buffer.concat(outputChunks))
    })
    try {
      for (const entry of entries) {
        const level = entry.binary ? 0 : 6
        const ze = new ZipDeflate(entry.name, { level })
        zip.add(ze)
        ze.push(new Uint8Array(entry.data), true)
      }
      zip.end()
    } catch (err) {
      reject(err)
    }
  })
}

export async function runBackup(): Promise<BackupResult> {
  const start = Date.now()
  const pool = getPool()
  const client = await pool.connect()
  const r2 = getR2Client()

  try {
    // ── 1. Dump all public DB tables ──────────────────────────────────────
    const tablesRes = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_type = 'BASE TABLE'
       ORDER BY table_name`
    )
    const tables = tablesRes.rows.map((r) => r.table_name)

    const entries: ZipEntry[] = []
    const rowCounts: Record<string, number> = {}
    let totalRows = 0

    for (const table of tables) {
      const res = await client.query(`SELECT * FROM public."${table}"`)
      rowCounts[table] = res.rowCount ?? res.rows.length
      totalRows += rowCounts[table]
      entries.push({
        name: `db/public.${table}.json`,
        data: Buffer.from(JSON.stringify(res.rows)),
      })
    }

    // ── 2. Enumerate every R2 file across all tracked prefixes ────────────
    const r2Files = await listAllR2Files(r2, FILE_PREFIXES)
    const filesManifest: Array<{ key: string; size: number }> = []
    let filesCount = 0
    let filesSizeBytes = 0

    // ── 3. Download each R2 file and add it to the zip ────────────────────
    for (const file of r2Files) {
      try {
        const data = await downloadR2File(r2, file.key)
        entries.push({ name: `files/${file.key}`, data, binary: true })
        filesManifest.push({ key: file.key, size: file.size })
        filesCount++
        filesSizeBytes += file.size
      } catch (err) {
        console.warn(`[backup] skipped R2 file ${file.key}:`, err)
      }
    }

    // ── 4. Write the manifest (first entry in the zip) ────────────────────
    const manifest = {
      version: 2,
      timestamp: new Date().toISOString(),
      db: { tables, row_counts: rowCounts, total_rows: totalRows },
      files: { count: filesCount, size_bytes: filesSizeBytes, entries: filesManifest },
    }
    entries.unshift({
      name: "manifest.json",
      data: Buffer.from(JSON.stringify(manifest, null, 2)),
    })

    // ── 5. Build zip and upload to R2 ─────────────────────────────────────
    const buffer = await buildZip(entries)
    const ts = timestamp()
    const key = `backups/db/backup_${ts}.zip`
    await putRaw(key, buffer, "application/zip")

    return {
      key,
      size: buffer.length,
      tables,
      total_rows: totalRows,
      files_count: filesCount,
      files_size_bytes: filesSizeBytes,
      duration_ms: Date.now() - start,
    }
  } finally {
    client.release()
    await pool.end()
  }
}
