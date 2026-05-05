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

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? ""
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? ""
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "openai/text-embedding-3-small"

// Chunking
const CHUNK_SIZE = 800
const CHUNK_OVERLAP = 200

// ---------------------------------------------------------------------------
// Text chunking (pure JS, no external dependency needed)
// ---------------------------------------------------------------------------

function chunkText(text: string): string[] {
  if (!text || text.trim().length < 20) return text?.trim() ? [text.trim()] : []

  const trimmed = text.trim()
  if (trimmed.length <= CHUNK_SIZE) return [trimmed]

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

  return chunks.filter((c) => c.trim().length >= 20)
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

    // 1. Chunk
    const chunks = chunkText(input.content)
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

    // 3. Idempotent delete
    const { error: deleteError } = await supabase
      .from("rag_documents")
      .delete()
      .eq("source_type", input.source_type)
      .eq("source_id", input.source_id)
    if (deleteError) {
      console.warn(
        `[rag] delete prior chunks for ${input.source_type}:${input.source_id} non-fatal:`,
        deleteError.message,
      )
    }

    // 4. Insert
    const rows = chunks.map((chunk, i) => ({
      source_type: input.source_type,
      source_id: input.source_id,
      chunk_index: i,
      team_id: input.team_id ?? null,
      owner_id: input.owner_id ?? null,
      title: input.title ?? null,
      content: chunk,
      // pgvector wire-format literal — see vectorToPg
      embedding: vectorToPg(vectors[i]),
      metadata: {
        ...(input.metadata ?? {}),
        chunk_index: i,
        total_chunks: chunks.length,
      },
    }))

    const { error: insertError } = await supabase.from("rag_documents").insert(rows)
    if (insertError) {
      console.error(
        `[rag] insert ${input.source_type}:${input.source_id} failed:`,
        insertError.message,
        insertError.details,
        insertError.hint,
      )
      return {
        ok: false,
        reason: `insert failed: ${insertError.message}${
          insertError.hint ? ` (hint: ${insertError.hint})` : ""
        }`,
      }
    }

    console.log(
      `[rag] indexed ${input.source_type}:${input.source_id} ✓ (${chunks.length} chunks)`,
    )
    return { ok: true, chunks: chunks.length }
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
  if (!isSupabaseConfigured()) return

  try {
    const supabase = createAdminClient()
    await supabase
      .from("rag_documents")
      .delete()
      .eq("source_type", args.source_type)
      .eq("source_id", args.source_id)
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
