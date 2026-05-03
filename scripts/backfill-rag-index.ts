/**
 * scripts/backfill-rag-index.ts
 * ============================
 *
 * One-shot script that walks every existing announcement / material / task /
 * submission row in Supabase and pushes it into the rag-service index. Run
 * this once after the Railway migration to seed pgvector with everything
 * the portal accumulated under managed Supabase.
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
 * The script is idempotent: rag-service upserts on (source_type, source_id),
 * so re-running it just refreshes the embeddings.
 */

import { createAdminClient } from "@/lib/supabase/admin"
import { indexDocument, joinContent } from "@/lib/smart-ai/indexer"

type Counter = { ok: number; skipped: number; failed: number }

function newCounter(): Counter {
  return { ok: 0, skipped: 0, failed: 0 }
}

async function backfillAnnouncements(c: Counter) {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("announcements")
    .select("id, author_id, team_id, title, body, priority")
  if (error) {
    console.error("[backfill] announcements query failed", error)
    return
  }
  for (const row of data ?? []) {
    try {
      await indexDocument({
        source_type: "announcement",
        source_id: row.id,
        team_id: row.team_id,
        owner_id: row.author_id,
        title: row.title,
        content: joinContent([row.title, row.body]),
        metadata: { priority: row.priority },
      })
      c.ok++
    } catch (err) {
      console.warn("[backfill] announcement", row.id, "failed", err)
      c.failed++
    }
  }
}

async function backfillMaterials(c: Counter) {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("materials")
    .select("id, author_id, team_id, title, description, tags, file_type")
  if (error) {
    console.error("[backfill] materials query failed", error)
    return
  }
  for (const row of data ?? []) {
    try {
      const tags = (row.tags ?? []) as string[]
      await indexDocument({
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
      })
      c.ok++
    } catch (err) {
      console.warn("[backfill] material", row.id, "failed", err)
      c.failed++
    }
  }
}

async function backfillTasks(c: Counter) {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("tasks")
    .select("id, manager_id, team_id, title, description, instructions, due_at, allow_late")
  if (error) {
    console.error("[backfill] tasks query failed", error)
    return
  }
  for (const row of data ?? []) {
    try {
      await indexDocument({
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
      })
      c.ok++
    } catch (err) {
      console.warn("[backfill] task", row.id, "failed", err)
      c.failed++
    }
  }
}

async function backfillSubmissions(c: Counter) {
  const admin = createAdminClient()
  // Only rows with extracted_text or summary — pre-validation submissions
  // would just produce a stub and aren't worth the embedding spend.
  const { data, error } = await admin
    .from("submissions")
    .select("id, uploader_id, team_id, title, status, score, summary, extracted_text, flags, task_id, is_late")
    .not("status", "in", "(queued,parsing,validating)")
  if (error) {
    console.error("[backfill] submissions query failed", error)
    return
  }
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
      c.skipped++
      continue
    }
    try {
      await indexDocument({
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
      c.ok++
    } catch (err) {
      console.warn("[backfill] submission", row.id, "failed", err)
      c.failed++
    }
  }
}

async function main() {
  console.log("[backfill] starting RAG index backfill")
  const counters = {
    announcements: newCounter(),
    materials: newCounter(),
    tasks: newCounter(),
    submissions: newCounter(),
  }

  await backfillAnnouncements(counters.announcements)
  await backfillMaterials(counters.materials)
  await backfillTasks(counters.tasks)
  await backfillSubmissions(counters.submissions)

  console.log("[backfill] done", counters)
}

main().catch((err) => {
  console.error("[backfill] fatal", err)
  process.exit(1)
})
