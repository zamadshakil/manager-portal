/**
 * scripts/backfill-rag-index.ts
 * ============================
 *
 * One-shot script that walks every existing announcement / material / task /
 * submission row in Supabase and pushes it into the rag-service index. Run
 * this once after the Railway migration to seed pgvector with everything
 * the portal accumulated under managed Supabase.
 *
 * v2: Now processes documents in concurrent batches (default 5) instead
 *     of sequentially. This is 3-5x faster on large datasets.
 *
 * Usage (from the repo root, with env vars loaded):
 *
 *     pnpm tsx scripts/backfill-rag-index.ts
 *
 * Required env vars (the same ones the portal already needs):
 *
 *     NEXT_PUBLIC_SUPABASE_URL    Kong public URL on Railway
 *     SUPABASE_SERVICE_ROLE_KEY   Self-hosted GoTrue service-role JWT
 *     RAG_SERVICE_URL             FastAPI rag-service public URL
 *     RAG_SERVICE_TOKEN           Shared bearer token
 *
 * The script is idempotent: rag-service upserts on (source_type, source_id,
 * chunk_index), so re-running it just refreshes the embeddings.
 */

import { createAdminClient } from "@/lib/supabase/admin"
import { indexDocument, joinContent, type IndexSourceType } from "@/lib/smart-ai/indexer"

// ---------------------------------------------------------------------------
// Batch concurrency helper
// ---------------------------------------------------------------------------

const BATCH_SIZE = Number(process.env.BACKFILL_CONCURRENCY ?? 5)

interface IndexJob {
  source_type: IndexSourceType
  source_id: string
  team_id: string | null
  owner_id: string | null
  title: string | null
  content: string
  metadata: Record<string, unknown>
}

type Counter = { ok: number; skipped: number; failed: number }

function newCounter(): Counter {
  return { ok: 0, skipped: 0, failed: 0 }
}

/**
 * Process an array of index jobs in concurrent batches.
 * Much faster than sequential processing — the RAG service handles
 * chunking + embedding internally so each call is self-contained.
 */
async function processBatch(jobs: IndexJob[], counter: Counter): Promise<void> {
  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const batch = jobs.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map((job) => indexDocument(job)),
    )

    for (let j = 0; j < results.length; j++) {
      const result = results[j]
      if (result.status === "fulfilled") {
        counter.ok++
      } else {
        counter.failed++
        console.warn(
          `[backfill] ${batch[j].source_type} ${batch[j].source_id} failed:`,
          result.reason?.message ?? result.reason,
        )
      }
    }

    // Progress report every batch
    const processed = Math.min(i + BATCH_SIZE, jobs.length)
    process.stdout.write(
      `\r  [${jobs[0]?.source_type}] ${processed}/${jobs.length} ` +
      `(${counter.ok} ok, ${counter.failed} failed)`,
    )
  }

  if (jobs.length > 0) {
    process.stdout.write("\n")
  }
}

// ---------------------------------------------------------------------------
// Data loaders — each returns an array of IndexJob
// ---------------------------------------------------------------------------

async function loadAnnouncements(): Promise<IndexJob[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("announcements")
    .select("id, author_id, team_id, title, body, priority")
  if (error) {
    console.error("[backfill] announcements query failed", error)
    return []
  }
  return (data ?? []).map((row) => ({
    source_type: "announcement",
    source_id: row.id,
    team_id: row.team_id,
    owner_id: row.author_id,
    title: row.title,
    content: joinContent([row.title, row.body]),
    metadata: { priority: row.priority },
  }))
}

async function loadMaterials(): Promise<IndexJob[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("materials")
    .select("id, author_id, team_id, title, description, tags, file_type")
  if (error) {
    console.error("[backfill] materials query failed", error)
    return []
  }
  return (data ?? []).map((row) => {
    const tags = (row.tags ?? []) as string[]
    return {
      source_type: "material",
      source_id: row.id,
      team_id: row.team_id,
      owner_id: row.author_id,
      title: row.title,
      content: joinContent([
        row.title,
        row.description,
        tags.length ? `Tags: ${tags.join(", ")}` : null,
      ]),
      metadata: { tags, mime: row.file_type },
    }
  })
}

async function loadTasks(): Promise<IndexJob[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("tasks")
    .select("id, manager_id, team_id, title, description, instructions, due_at, allow_late")
  if (error) {
    console.error("[backfill] tasks query failed", error)
    return []
  }
  return (data ?? []).map((row) => ({
    source_type: "task",
    source_id: row.id,
    team_id: row.team_id,
    owner_id: row.manager_id,
    title: row.title,
    content: joinContent([
      row.title,
      row.description,
      row.instructions,
      row.due_at ? `Deadline: ${row.due_at}` : null,
    ]),
    metadata: { due_at: row.due_at, allow_late: row.allow_late },
  }))
}

async function loadSubmissions(): Promise<{ jobs: IndexJob[]; skipped: number }> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("submissions")
    .select("id, uploader_id, team_id, title, status, score, summary, extracted_text, flags, task_id, is_late")
    .not("status", "in", "(queued,parsing,validating)")
  if (error) {
    console.error("[backfill] submissions query failed", error)
    return { jobs: [], skipped: 0 }
  }

  let skipped = 0
  const jobs: IndexJob[] = []

  for (const row of data ?? []) {
    const text = joinContent([
      row.title,
      row.summary,
      row.extracted_text,
      Array.isArray(row.flags)
        ? (row.flags as Array<{ severity: string; rule_name?: string; message: string }>)
            .map((f) => `[${f.severity}] ${f.rule_name ?? ""}: ${f.message}`)
            .join("\n")
        : null,
    ])
    if (text.trim().length < 8) {
      skipped++
      continue
    }
    jobs.push({
      source_type: "submission",
      source_id: row.id,
      team_id: row.team_id,
      owner_id: row.uploader_id,
      title: row.title,
      content: text,
      metadata: {
        status: row.status,
        score: row.score,
        task_id: row.task_id,
        is_late: row.is_late,
      },
    })
  }

  return { jobs, skipped }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`[backfill] starting RAG index backfill (concurrency: ${BATCH_SIZE})`)
  const startedAt = Date.now()

  const counters = {
    announcements: newCounter(),
    materials: newCounter(),
    tasks: newCounter(),
    submissions: newCounter(),
  }

  // Load all data first, then process in batches
  console.log("[backfill] loading data from Supabase...")

  const [announcements, materials, tasks, submissionsResult] = await Promise.all([
    loadAnnouncements(),
    loadMaterials(),
    loadTasks(),
    loadSubmissions(),
  ])

  console.log(
    `[backfill] loaded ${announcements.length} announcements, ` +
    `${materials.length} materials, ${tasks.length} tasks, ` +
    `${submissionsResult.jobs.length} submissions ` +
    `(${submissionsResult.skipped} submissions skipped)`,
  )

  counters.submissions.skipped = submissionsResult.skipped

  // Process each source type in concurrent batches
  await processBatch(announcements, counters.announcements)
  await processBatch(materials, counters.materials)
  await processBatch(tasks, counters.tasks)
  await processBatch(submissionsResult.jobs, counters.submissions)

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(`[backfill] done in ${elapsed}s`, counters)
}

main().catch((err) => {
  console.error("[backfill] fatal", err)
  process.exit(1)
})
