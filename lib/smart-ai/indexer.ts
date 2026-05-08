import "server-only"

/**
 * RAG Indexing – Native Supabase Implementation
 * ==============================================
 *
 * Generates embeddings and stores document chunks directly into the
 * `rag_documents` pgvector table via the Supabase service-role client.
 *
 * Embedding provider resolution:
 *   1. OPENAI_API_KEY      → call OpenAI directly (most reliable for embeddings)
 *   2. OPENROUTER_API_KEY  → call OpenRouter's OpenAI-compatible /embeddings
 *
 * Design rules:
 *   - Indexing is best-effort. Failures here never block the user-facing
 *     response, but we DO bubble the actual reason up to the caller so the
 *     UI / logs can show it instead of a generic "failed".
 *   - Vectors are inserted as the pgvector text literal `"[0.1,0.2,...]"`,
 *     which is the only format that survives PostgREST without being
 *     reinterpreted as a Postgres array.
 *   - The `rag_documents` table, pgvector extension, indexes, RLS, RPCs and
 *     tsv trigger are managed by `supabase/migrations/20260505_rag_documents.sql`.
 */

import { createAdminClient } from "@/lib/supabase/admin"
import { isDirectPgConfigured, pgQuery } from "@/lib/smart-ai/pg-client"
import { ensureRagSchema } from "@/lib/smart-ai/bootstrap"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? ""
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? ""
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "openai/text-embedding-3-small"

// Chunking — larger chunks preserve section context (headers + body stay
// together). 1200 chars is well within the 8191-token limit of
// text-embedding-3-small. The 400-char overlap ensures section boundaries
// are duplicated across adjacent chunks.
const CHUNK_SIZE = 1200
const CHUNK_OVERLAP = 400

// ---------------------------------------------------------------------------
// Text chunking (pure JS, no external dependency needed)
// ---------------------------------------------------------------------------

function chunkText(text: string, titlePrefix?: string): string[] {
  if (!text || text.trim().length < 20) return text?.trim() ? [text.trim()] : []

  const trimmed = text.trim()
  if (trimmed.length <= CHUNK_SIZE) {
    const prefix = titlePrefix?.trim() ? `[${titlePrefix.trim()}]\n\n` : ""
    return [`${prefix}${trimmed}`]
  }

  const chunks: string[] = []
  const separators = ["\n\n", "\n", ". ", " "]

  function splitRecursive(content: string, sepIdx: number): string[] {
    if (content.length <= CHUNK_SIZE) return [content]
    if (sepIdx >= separators.length) {
      const parts: string[] = []
      for (let i = 0; i < content.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
        parts.push(content.slice(i, i + CHUNK_SIZE))
      }
      return parts
    }

    const sep = separators[sepIdx]
    const segments = content.split(sep)
    const result: string[] = []
    let current = ""

    for (const seg of segments) {
      const candidate = current ? current + sep + seg : seg
      if (candidate.length > CHUNK_SIZE && current) {
        result.push(current)
        const overlapStart = Math.max(0, current.length - CHUNK_OVERLAP)
        current = current.slice(overlapStart) + sep + seg
        if (current.length > CHUNK_SIZE) {
          result.push(...splitRecursive(current, sepIdx + 1))
          current = ""
        }
      } else {
        current = candidate
      }
    }
    if (current.trim()) result.push(current)
    return result
  }

  chunks.push(...splitRecursive(trimmed, 0))

  // Prepend the document title to every chunk as a semantic anchor.
  // This dramatically improves retrieval for targeted searches because
  // every chunk embeds with the document's topic, not just its fragment.
  const prefix = titlePrefix?.trim() ? `[${titlePrefix.trim()}]\n\n` : ""
  return chunks
    .filter((c) => c.trim().length >= 20)
    .map((c) => `${prefix}${c}`)
}

// ---------------------------------------------------------------------------
// Embedding via OpenAI / OpenRouter
// ---------------------------------------------------------------------------

interface EmbedResponse {
  data: Array<{ embedding: number[]; index?: number }>
}

/**
 * Stringify the model id correctly for whichever provider we're hitting.
 * - OpenAI direct expects no provider prefix (`text-embedding-3-small`).
 * - OpenRouter expects `openai/text-embedding-3-small`.
 */
function modelForProvider(provider: "openai" | "openrouter"): string {
  if (provider === "openai") return EMBEDDING_MODEL.replace(/^openai\//, "")
  return EMBEDDING_MODEL.includes("/") ? EMBEDDING_MODEL : `openai/${EMBEDDING_MODEL}`
}

async function callEmbedAPI(
  url: string,
  apiKey: string,
  model: string,
  texts: string[],
  extraHeaders: Record<string, string> = {},
): Promise<number[][]> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify({ model, input: texts }),
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(
      `embedding API ${res.status} ${res.statusText} via ${new URL(url).host}: ${body.slice(0, 400)}`,
    )
  }

  let json: EmbedResponse
  try {
    json = (await res.json()) as EmbedResponse
  } catch (err: any) {
    throw new Error(`embedding API returned non-JSON: ${err?.message ?? String(err)}`)
  }

  if (!json?.data?.length) {
    throw new Error(`embedding API returned empty data array (model="${model}")`)
  }

  // Sort by index when the field is present so we keep order stable across batches.
  // OpenAI sets `.index`; OpenRouter doesn't always — fall back to insertion order.
  const sorted = json.data.every((d) => typeof d.index === "number")
    ? [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    : json.data

  return sorted.map((d) => d.embedding)
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!texts.length) return []

  if (OPENAI_API_KEY) {
    return callEmbedAPI(
      "https://api.openai.com/v1/embeddings",
      OPENAI_API_KEY,
      modelForProvider("openai"),
      texts,
    )
  }

  if (OPENROUTER_API_KEY) {
    return callEmbedAPI(
      "https://openrouter.ai/api/v1/embeddings",
      OPENROUTER_API_KEY,
      modelForProvider("openrouter"),
      texts,
      {
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL ?? "https://hierarchia.app",
        "X-Title": "Hierarchia Smart AI",
      },
    )
  }

  throw new Error("no embedding API key configured (set OPENAI_API_KEY or OPENROUTER_API_KEY)")
}

/**
 * Format a vector for pgvector via PostgREST.
 *
 * Critical: PostgREST treats a JSON array sent for a `vector` column as a
 * Postgres `ARRAY` and the insert silently ends up with an empty / wrong
 * value (or fails with a type cast error depending on Supabase version).
 * The reliable wire format is the pgvector text literal: `"[0.1, 0.2, ...]"`.
 */
function vectorToPg(vec: number[]): string {
  return `[${vec.join(",")}]`
}

// ---------------------------------------------------------------------------
// Insert paths — direct Postgres, RPC, PostgREST (in order of reliability)
// ---------------------------------------------------------------------------

interface IndexedRow {
  source_type: string
  source_id: string
  chunk_index: number
  team_id: string | null
  owner_id: string | null
  title: string | null
  content: string
  embedding: string // pgvector text literal "[0.1,0.2,...]"
  metadata: Record<string, unknown>
}

/**
 * Talk to Postgres directly via the `pg` driver. This bypasses PostgREST
 * + Kong + the schema cache entirely. Most reliable path; preferred when
 * a DB connection string is available.
 */
async function insertViaDirectPg(rows: IndexedRow[]): Promise<void> {
  // 1. Idempotent delete — single statement, parameterised.
  // We dedupe (source_type, source_id) tuples so the WHERE is compact.
  const seen = new Set<string>()
  const sourceTypes: string[] = []
  const sourceIds: string[] = []
  for (const r of rows) {
    const key = `${r.source_type}::${r.source_id}`
    if (seen.has(key)) continue
    seen.add(key)
    sourceTypes.push(r.source_type)
    sourceIds.push(r.source_id)
  }
  await pgQuery(
    `DELETE FROM rag_documents
       WHERE (source_type, source_id) IN (
         SELECT * FROM unnest($1::text[], $2::text[])
       )`,
    [sourceTypes, sourceIds],
  )

  // 2. Multi-row insert. Postgres caps parameters at 65535, so we chunk.
  const PARAMS_PER_ROW = 9
  const MAX_ROWS_PER_BATCH = Math.floor(60_000 / PARAMS_PER_ROW)
  for (let start = 0; start < rows.length; start += MAX_ROWS_PER_BATCH) {
    const batch = rows.slice(start, start + MAX_ROWS_PER_BATCH)
    const valuesSql: string[] = []
    const params: unknown[] = []
    let p = 1
    for (const r of batch) {
      valuesSql.push(
        `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}::vector, $${p++}::jsonb)`,
      )
      params.push(
        r.source_type,
        r.source_id,
        r.chunk_index,
        r.team_id,
        r.owner_id,
        r.title,
        r.content,
        r.embedding,
        JSON.stringify(r.metadata),
      )
    }
    await pgQuery(
      `INSERT INTO rag_documents
         (source_type, source_id, chunk_index, team_id, owner_id, title, content, embedding, metadata)
       VALUES ${valuesSql.join(",")}`,
      params,
    )
  }
}

/**
 * Talk to Postgres via the `insert_rag_chunks(jsonb)` RPC. Also bypasses
 * PostgREST's column-level cache (RPCs are validated against the function
 * signature cache, which is reloaded reliably).
 */
async function insertViaRpc(
  supabase: ReturnType<typeof createAdminClient>,
  rows: IndexedRow[],
): Promise<void> {
  const { error: deleteError } = await supabase.rpc("delete_rag_chunks", {
    p_source_type: rows[0].source_type,
    p_source_id: rows[0].source_id,
  })
  if (deleteError) {
    console.warn("[rag] delete_rag_chunks rpc non-fatal:", deleteError.message)
  }
  const { error } = await supabase.rpc("insert_rag_chunks", { rows: rows as unknown as any })
  if (error) {
    throw new Error(
      `${error.message}${error.hint ? ` (hint: ${error.hint})` : ""}${
        error.details ? ` [${error.details}]` : ""
      }`,
    )
  }
}

/**
 * Last-resort PostgREST direct table insert. Subject to the schema-cache
 * issue we've been hitting — only used when the other two paths are
 * unavailable so we still have *something* in dev environments without a
 * DB URL or migrated functions.
 */
async function insertViaPostgrest(
  supabase: ReturnType<typeof createAdminClient>,
  rows: IndexedRow[],
): Promise<void> {
  const r0 = rows[0]
  await supabase
    .from("rag_documents")
    .delete()
    .eq("source_type", r0.source_type)
    .eq("source_id", r0.source_id)
  const { error } = await supabase.from("rag_documents").insert(rows as unknown as any)
  if (error) {
    throw new Error(
      `${error.message}${error.hint ? ` (hint: ${error.hint})` : ""}${
        error.details ? ` [${error.details}]` : ""
      }`,
    )
  }
}

// ---------------------------------------------------------------------------
// Public API — Types
// ---------------------------------------------------------------------------

export type IndexSourceType =
  | "announcement"
  | "material"
  | "task"
  | "submission"
  | "validation_run"
  | "rule"
  | "chat_attachment"

export interface IndexDocumentInput {
  source_type: IndexSourceType
  source_id: string
  team_id?: string | null
  owner_id?: string | null
  title?: string | null
  content: string
  metadata?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Supabase availability check
// ---------------------------------------------------------------------------

function isSupabaseConfigured(): boolean {
  try {
    createAdminClient()
    return true
  } catch {
    return false
  }
}

function hasEmbeddingKey(): boolean {
  return Boolean(OPENAI_API_KEY || OPENROUTER_API_KEY)
}

// ---------------------------------------------------------------------------
// Public API — indexDocument
// ---------------------------------------------------------------------------

/**
 * Push a single document into pgvector. Idempotent — deletes existing
 * chunks for the same (source_type, source_id), then inserts new ones.
 */
export async function indexDocument(
  input: IndexDocumentInput,
): Promise<{ ok: boolean; reason?: string; chunks?: number }> {
  if (!isSupabaseConfigured()) {
    console.warn("[rag] indexing skipped: Supabase not configured")
    return { ok: false, reason: "disabled: supabase not configured" }
  }

  if (!hasEmbeddingKey()) {
    console.warn("[rag] indexing skipped: no embedding API key")
    return { ok: false, reason: "disabled: no embedding API key" }
  }

  const disabled = (process.env.RAG_INDEX_DISABLED_TYPES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  if (disabled.includes(input.source_type)) {
    console.log(`[rag] indexing skipped: ${input.source_type} disabled via env`)
    return { ok: false, reason: `disabled: ${input.source_type} kill-switch` }
  }

  if (!input.content || input.content.trim().length < 16) {
    return { ok: false, reason: "skipped: content too short" }
  }

  try {
    const supabase = createAdminClient()

    // 1. Chunk — pass the title so each chunk embeds with document context.
    const chunks = chunkText(input.content, input.title ?? undefined)
    if (!chunks.length) return { ok: false, reason: "skipped: no chunks produced" }

    console.log(
      `[rag] indexing ${input.source_type}:${input.source_id} → ${chunks.length} chunks`,
    )

    // 2. Embed
    let vectors: number[][]
    try {
      vectors = await embedTexts(chunks)
    } catch (embedErr: any) {
      console.error(
        `[rag] embedding ${input.source_type}:${input.source_id} failed:`,
        embedErr?.message ?? embedErr,
      )
      return { ok: false, reason: `embedding failed: ${embedErr?.message ?? "unknown"}` }
    }

    if (vectors.length !== chunks.length) {
      return {
        ok: false,
        reason: `embedding count mismatch (${vectors.length} vs ${chunks.length} chunks)`,
      }
    }

    // 3. Build rows
    const rows: IndexedRow[] = chunks.map((chunk, i) => ({
      source_type: input.source_type,
      source_id: input.source_id,
      chunk_index: i,
      team_id: input.team_id ?? null,
      owner_id: input.owner_id ?? null,
      title: input.title ?? null,
      content: chunk,
      embedding: vectorToPg(vectors[i]),
      metadata: {
        ...(input.metadata ?? {}),
        chunk_index: i,
        total_chunks: chunks.length,
      },
    }))

    // 4. Insert via the most reliable path available.
    //
    //    When `SUPABASE_DB_URL` (or another DB connection string) is set
    //    we ALWAYS use direct Postgres. It's strictly more reliable than
    //    going through PostgREST/Kong and it sidesteps every schema-
    //    cache problem we've ever had on the self-hosted Supabase stack.
    //    We also auto-bootstrap the RAG schema + RPCs the first time
    //    through, so a fresh deploy "just works" without a manual
    //    migration step.
    //
    //    When direct PG is NOT configured we fall back to the Supabase
    //    RPC and finally a PostgREST insert. Both depend on the
    //    PostgREST schema cache and the `insert_rag_chunks` migration
    //    having been applied — if either is broken we surface the
    //    actual reason so the operator knows what to fix.
    const errors: string[] = []

    if (isDirectPgConfigured()) {
      // Self-heal the schema if needed (no-op after the first call).
      const bootstrap = await ensureRagSchema()
      if (!bootstrap.ok) {
        console.warn(`[rag] bootstrap reported issue: ${bootstrap.reason}`)
        // Don't bail — direct-pg might still work for an already-correct
        // database, and the bootstrap may have failed only on the
        // optional NOTIFY step.
      }

      try {
        await insertViaDirectPg(rows)
        console.log(
          `[rag] indexed ${input.source_type}:${input.source_id} via direct-pg (${chunks.length} chunks)`,
        )
        return { ok: true, chunks: chunks.length }
      } catch (err: any) {
        const msg = err?.message ?? String(err)
        console.error(`[rag] direct-pg insert failed: ${msg}`)
        return {
          ok: false,
          reason: `direct-pg insert failed: ${msg}${
            bootstrap.ok ? "" : ` (bootstrap: ${bootstrap.reason})`
          }`,
        }
      }
    }

    // No direct PG — try RPC, then PostgREST. These are best-effort and
    // both depend on PostgREST being healthy + migrations being applied.
    try {
      await insertViaRpc(supabase, rows)
      console.log(
        `[rag] indexed ${input.source_type}:${input.source_id} via rpc (${chunks.length} chunks)`,
      )
      return { ok: true, chunks: chunks.length }
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      console.warn(`[rag] rpc insert failed, falling back to PostgREST: ${msg}`)
      errors.push(`rpc: ${msg}`)
    }

    try {
      await insertViaPostgrest(supabase, rows)
      console.log(
        `[rag] indexed ${input.source_type}:${input.source_id} via postgrest (${chunks.length} chunks)`,
      )
      return { ok: true, chunks: chunks.length }
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      errors.push(`postgrest: ${msg}`)
    }

    console.error(
      `[rag] all insert paths failed for ${input.source_type}:${input.source_id}:`,
      errors.join(" | "),
    )
    return {
      ok: false,
      reason:
        `insert failed: ${errors.join(" | ")}. ` +
        `Fix: set SUPABASE_DB_URL on manager-portal to enable the bulletproof direct-pg path, ` +
        `or apply supabase/migrations/20260506_rag_rpc.sql to your Postgres.`,
    }
  } catch (err: any) {
    console.error(
      `[rag] index ${input.source_type}:${input.source_id} unexpected error:`,
      err?.message ?? err,
    )
    return { ok: false, reason: err?.message ?? "indexing error" }
  }
}

// ---------------------------------------------------------------------------
// Public API — deleteIndexed
// ---------------------------------------------------------------------------

export async function deleteIndexed(args: {
  source_type: IndexSourceType
  source_id: string
}): Promise<void> {
  // Fire-and-forget delete using whichever path is available. Same priority
  // as inserts so we don't depend on PostgREST being healthy.
  if (isDirectPgConfigured()) {
    try {
      await pgQuery(
        `DELETE FROM rag_documents WHERE source_type = $1 AND source_id = $2`,
        [args.source_type, args.source_id],
      )
      return
    } catch (err) {
      console.warn(`[rag] direct-pg delete ${args.source_type}:${args.source_id} threw`, err)
    }
  }

  if (!isSupabaseConfigured()) return

  try {
    const supabase = createAdminClient()
    const { error: rpcErr } = await supabase.rpc("delete_rag_chunks", {
      p_source_type: args.source_type,
      p_source_id: args.source_id,
    })
    if (rpcErr) {
      // Fall back to PostgREST delete — this one usually works since
      // it doesn't reference any disputed columns.
      await supabase
        .from("rag_documents")
        .delete()
        .eq("source_type", args.source_type)
        .eq("source_id", args.source_id)
    }
  } catch (err) {
    console.warn(`[rag] delete ${args.source_type}:${args.source_id} threw`, err)
  }
}

// ---------------------------------------------------------------------------
// Public API — joinContent
// ---------------------------------------------------------------------------

export function joinContent(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (p ?? "").trim())
    .filter((p) => p.length > 0)
    .join("\n\n")
}
