import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/auth"
import { get as r2Get } from "@/lib/r2"
import { zip } from "fflate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

// ---------------------------------------------------------------------------
// Concurrency cap — 6 parallel R2 fetches.
// Reasoning: 6 × 25 MB (max file size) = 150 MB peak buffer, well within
// typical Node.js heap. Keeps wall-time fast while staying under R2 soft
// rate-limits and avoiding OOM spikes on large batches.
// ---------------------------------------------------------------------------
const CONCURRENCY = 6
const MAX_EXPORT_BYTES = 500 * 1024 * 1024 // 500 MB safety ceiling

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function drainStream(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of stream) {
    const buf = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBuffer)
    chunks.push(buf)
    total += buf.byteLength
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.byteLength }
  return out
}

async function withConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null)
  let idx = 0
  const worker = async () => {
    for (;;) {
      const i = idx++
      if (i >= items.length) return
      try { results[i] = await fn(items[i], i) }
      catch (err) { console.error("[export] R2 fetch failed idx=%d", i, err) }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

function safeName(str: string, maxLen = 80): string {
  return (str ?? "file")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLen) || "file"
}

const MIME_TO_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "text/plain": "txt",
  "text/markdown": "md",
  "application/zip": "zip",
  "application/x-zip-compressed": "zip",
  "application/vnd.rar": "rar",
  "application/x-rar-compressed": "rar",
}

function mimeToExt(mime: string): string {
  return MIME_TO_EXT[(mime ?? "").toLowerCase()] ?? "bin"
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const profile = await requireRole(["main_admin", "manager"])

  const sp = request.nextUrl.searchParams
  const type = (sp.get("type") ?? "materials") as "materials" | "submissions"
  const from = sp.get("from") || null
  const to = sp.get("to") || null
  const teamId = sp.get("team") || null
  const statusList = sp.get("status")?.split(",").filter(Boolean) ?? []
  const tagList = sp.get("tags")?.split(",").map((t) => t.trim()).filter(Boolean) ?? []
  const mimeList = sp.get("mimeTypes")?.split(",").filter(Boolean) ?? []

  // Managers are always scoped to their own team regardless of query params
  const effectiveTeam =
    profile.role === "manager" ? profile.team_id : (teamId || null)

  const dateFrom = from ? new Date(from).toISOString() : null
  const dateTo = to ? new Date(`${to}T23:59:59`).toISOString() : null

  const supabase = await createClient()

  type Entry = {
    zipPath: string
    blobUrl: string
    sizeBytes: number
  }
  const entries: Entry[] = []

  // -------------------------------------------------------------------------
  // Build entry list from DB
  // -------------------------------------------------------------------------
  if (type === "materials") {
    let q = supabase
      .from("materials")
      .select("id, title, blob_url, file_type, tags, team_id, size_bytes, teams(name)")
      .order("created_at", { ascending: true })
      .limit(500)

    if (dateFrom) q = q.gte("created_at", dateFrom)
    if (dateTo) q = q.lte("created_at", dateTo)
    if (effectiveTeam) q = q.eq("team_id", effectiveTeam)
    if (mimeList.length) q = q.in("file_type", mimeList)

    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const rows = (data ?? []) as unknown as Array<{
      id: string
      title: string
      blob_url: string
      file_type: string | null
      tags: string[]
      team_id: string | null
      size_bytes: number | null
      teams: { name: string } | null
    }>

    const filtered =
      tagList.length > 0
        ? rows.filter((r) => r.tags.some((t) => tagList.includes(t)))
        : rows

    for (const r of filtered) {
      if (!r.blob_url) continue
      const teamName = r.teams?.name ?? "global"
      const ext = mimeToExt(r.file_type ?? "")
      const shortId = r.id.slice(0, 6)
      entries.push({
        zipPath: `materials/${safeName(teamName)}/${safeName(r.title)}-${shortId}.${ext}`,
        blobUrl: r.blob_url,
        sizeBytes: r.size_bytes ?? 0,
      })
    }
  } else {
    let q = supabase
      .from("submissions")
      .select(
        "id, title, blob_url, mime_type, status, uploader_id, team_id, size_bytes, teams(name)",
      )
      .order("created_at", { ascending: true })
      .limit(500)

    if (dateFrom) q = q.gte("created_at", dateFrom)
    if (dateTo) q = q.lte("created_at", dateTo)
    if (effectiveTeam) q = q.eq("team_id", effectiveTeam)
    if (statusList.length) q = q.in("status", statusList as any)
    if (mimeList.length) q = q.in("mime_type", mimeList)

    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const rows = (data ?? []) as unknown as Array<{
      id: string
      title: string
      blob_url: string
      mime_type: string
      status: string
      uploader_id: string
      team_id: string
      size_bytes: number | null
      teams: { name: string } | null
    }>

    // Batch-load uploader display names
    const uploaderIds = [...new Set(rows.map((r) => r.uploader_id))]
    const uploaderMap: Record<string, string> = {}
    if (uploaderIds.length > 0) {
      const { data: profileRows } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", uploaderIds)
      for (const p of profileRows ?? []) {
        uploaderMap[p.id] = (p.full_name as string | null) ?? (p.email as string)
      }
    }

    for (const r of rows) {
      if (!r.blob_url) continue
      const teamName = r.teams?.name ?? "unknown-team"
      const uploaderName = uploaderMap[r.uploader_id] ?? r.uploader_id.slice(0, 8)
      const ext = mimeToExt(r.mime_type)
      const shortId = r.id.slice(0, 6)
      entries.push({
        zipPath: `submissions/${safeName(teamName)}/${safeName(uploaderName)}/${safeName(r.title)}-${shortId}.${ext}`,
        blobUrl: r.blob_url,
        sizeBytes: r.size_bytes ?? 0,
      })
    }
  }

  if (entries.length === 0) {
    return NextResponse.json(
      { error: "No files match the selected criteria." },
      { status: 404 },
    )
  }

  // Safety: reject exports that would exceed 500 MB in memory
  const estimatedBytes = entries.reduce((s, e) => s + e.sizeBytes, 0)
  if (estimatedBytes > MAX_EXPORT_BYTES) {
    return NextResponse.json(
      {
        error: `Export too large (${Math.round(estimatedBytes / 1024 / 1024)} MB). Narrow the date range or apply more filters.`,
      },
      { status: 413 },
    )
  }

  // -------------------------------------------------------------------------
  // Fetch all R2 files with concurrency cap
  // -------------------------------------------------------------------------
  const buffers = await withConcurrency(entries, CONCURRENCY, async (entry) => {
    const result = await r2Get(entry.blobUrl)
    return drainStream(result.stream as AsyncIterable<Uint8Array>)
  })

  // -------------------------------------------------------------------------
  // Assemble ZIP — level: 0 = STORE (no recompression; files already compressed)
  // -------------------------------------------------------------------------
  const fileMap: Record<string, [Uint8Array, { level: 0 }]> = {}
  const pathUsed = new Set<string>()

  for (let i = 0; i < entries.length; i++) {
    const buf = buffers[i]
    if (!buf) continue
    let path = entries[i].zipPath
    // Resolve any path collisions by appending a counter
    let n = 2
    while (pathUsed.has(path)) {
      const dot = path.lastIndexOf(".")
      path =
        dot >= 0
          ? `${path.slice(0, dot)}_${n++}${path.slice(dot)}`
          : `${path}_${n++}`
    }
    pathUsed.add(path)
    fileMap[path] = [buf, { level: 0 }]
  }

  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(fileMap, { level: 0 }, (err: Error | null, data: Uint8Array) => {
      if (err) reject(err)
      else resolve(data)
    })
  })

  const date = new Date().toISOString().split("T")[0]
  const filename = `${type}-export-${date}.zip`

  return new NextResponse(Buffer.from(zipped), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, no-cache",
      "X-Export-Count": String(pathUsed.size),
    },
  })
}
