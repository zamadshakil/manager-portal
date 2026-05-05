import "server-only"

/**
 * RAG schema auto-bootstrap.
 *
 * Why this exists
 * ---------------
 * On the self-hosted Supabase stack on Railway, applying SQL migrations
 * is a manual step (no automatic `supabase db push`). Two things tend to
 * go wrong in production:
 *
 *   1. The base `20260505_rag_documents.sql` migration was applied but
 *      the follow-up `20260506_rag_rpc.sql` (which creates the
 *      `insert_rag_chunks` / `delete_rag_chunks` RPCs) was NOT.
 *      Symptom:
 *        rag_status: "failed",
 *        rag_reason: "insert failed: Could not find the function
 *                     public.insert_rag_chunks(rows) in the schema cache"
 *
 *   2. The migration ran but PostgREST cached the old schema and never
 *      reloaded — the function exists in Postgres but not in the API.
 *
 * If the manager-portal service has a direct Postgres connection
 * available (`SUPABASE_DB_URL`, `DATABASE_URL`, etc.), we can fix BOTH
 * cases automatically by running the migrations idempotently against
 * Postgres directly, then sending `NOTIFY pgrst, 'reload schema'` so the
 * REST API picks up the changes.
 *
 * The bootstrap runs once per process, cached in a global flag.
 *
 * If direct PG is NOT configured, we leave a clear breadcrumb in the
 * error response so the operator knows what to do.
 */

import { isDirectPgConfigured, pgQuery } from "@/lib/smart-ai/pg-client"

declare global {
  // eslint-disable-next-line no-var
  var __ragBootstrapState:
    | {
        promise: Promise<RagBootstrapResult>
        result?: RagBootstrapResult
      }
    | undefined
}

export interface RagBootstrapResult {
  ok: boolean
  ranAt?: string
  reason?: string
  steps?: string[]
}

// ---------------------------------------------------------------------------
// SQL — split into discrete idempotent steps so a partial failure (e.g. a
// permission issue creating a SECURITY DEFINER function) doesn't roll back
// everything. Each step is logged independently.
// ---------------------------------------------------------------------------

const STEP_VECTOR_EXTENSION = `CREATE EXTENSION IF NOT EXISTS vector`

const STEP_TABLE = `
CREATE TABLE IF NOT EXISTS rag_documents (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type TEXT NOT NULL,
    source_id   TEXT NOT NULL,
    chunk_index INT  NOT NULL DEFAULT 0,
    team_id     TEXT,
    owner_id    TEXT,
    title       TEXT,
    content     TEXT NOT NULL,
    embedding   vector(1536),
    metadata    JSONB DEFAULT '{}'::jsonb,
    tsv         tsvector,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`

const STEP_TABLE_FIXUP = `
ALTER TABLE rag_documents
    ADD COLUMN IF NOT EXISTS source_type TEXT,
    ADD COLUMN IF NOT EXISTS source_id   TEXT,
    ADD COLUMN IF NOT EXISTS chunk_index INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS team_id     TEXT,
    ADD COLUMN IF NOT EXISTS owner_id    TEXT,
    ADD COLUMN IF NOT EXISTS title       TEXT,
    ADD COLUMN IF NOT EXISTS content     TEXT,
    ADD COLUMN IF NOT EXISTS embedding   vector(1536),
    ADD COLUMN IF NOT EXISTS metadata    JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS tsv         tsvector,
    ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()`

const STEP_INDEXES = `
CREATE INDEX IF NOT EXISTS rag_documents_embedding_hnsw_idx
    ON rag_documents USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS rag_documents_source_idx
    ON rag_documents (source_type, source_id);
CREATE INDEX IF NOT EXISTS rag_documents_owner_idx
    ON rag_documents (owner_id);
CREATE INDEX IF NOT EXISTS rag_documents_tsv_idx
    ON rag_documents USING GIN (tsv)`

const STEP_TSV_TRIGGER = `
CREATE OR REPLACE FUNCTION rag_documents_tsv_trigger()
RETURNS TRIGGER AS $$
BEGIN
    NEW.tsv := to_tsvector(
        'english',
        COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.content, '')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rag_documents_tsv_update ON rag_documents;
CREATE TRIGGER rag_documents_tsv_update
    BEFORE INSERT OR UPDATE ON rag_documents
    FOR EACH ROW
    EXECUTE FUNCTION rag_documents_tsv_trigger()`

const STEP_INSERT_RPC = `
CREATE OR REPLACE FUNCTION insert_rag_chunks(rows jsonb)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    inserted_count int;
BEGIN
    WITH input AS (
        SELECT * FROM jsonb_to_recordset(rows) AS x(
            source_type  text,
            source_id    text,
            chunk_index  int,
            team_id      text,
            owner_id     text,
            title        text,
            content      text,
            embedding    text,
            metadata     jsonb
        )
    )
    INSERT INTO rag_documents (
        source_type, source_id, chunk_index,
        team_id, owner_id, title, content,
        embedding, metadata
    )
    SELECT
        source_type, source_id, chunk_index,
        team_id, owner_id, title, content,
        embedding::vector,
        COALESCE(metadata, '{}'::jsonb)
    FROM input;

    GET DIAGNOSTICS inserted_count = ROW_COUNT;
    RETURN inserted_count;
END;
$$`

const STEP_DELETE_RPC = `
CREATE OR REPLACE FUNCTION delete_rag_chunks(
    p_source_type text,
    p_source_id   text
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_count int;
BEGIN
    DELETE FROM rag_documents
    WHERE source_type = p_source_type
      AND source_id   = p_source_id;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$`

const STEP_GRANTS = `
GRANT EXECUTE ON FUNCTION insert_rag_chunks(jsonb)      TO service_role, authenticated, anon;
GRANT EXECUTE ON FUNCTION delete_rag_chunks(text, text) TO service_role, authenticated, anon`

const STEP_NOTIFY = `NOTIFY pgrst, 'reload schema'`

interface Step {
  name: string
  sql: string
  /** When true, a failure is logged but doesn't fail the whole bootstrap. */
  optional?: boolean
}

const STEPS: Step[] = [
  { name: "vector_extension", sql: STEP_VECTOR_EXTENSION },
  { name: "table_create", sql: STEP_TABLE },
  { name: "table_fixup", sql: STEP_TABLE_FIXUP },
  { name: "indexes", sql: STEP_INDEXES },
  { name: "tsv_trigger", sql: STEP_TSV_TRIGGER },
  { name: "insert_rpc", sql: STEP_INSERT_RPC },
  { name: "delete_rpc", sql: STEP_DELETE_RPC },
  { name: "grants", sql: STEP_GRANTS, optional: true },
  { name: "notify_pgrst", sql: STEP_NOTIFY, optional: true },
]

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function runBootstrap(): Promise<RagBootstrapResult> {
  if (!isDirectPgConfigured()) {
    return {
      ok: false,
      reason:
        "direct PG not configured — set SUPABASE_DB_URL or DATABASE_URL on the manager-portal service to enable auto-bootstrap. Otherwise apply supabase/migrations/20260506_rag_rpc.sql manually.",
    }
  }

  const completed: string[] = []
  const failures: string[] = []

  for (const step of STEPS) {
    try {
      await pgQuery(step.sql)
      completed.push(step.name)
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      const label = `${step.name}: ${msg}`
      if (step.optional) {
        console.warn(`[rag-bootstrap] optional step failed (${label})`)
        completed.push(`${step.name} (skipped: ${msg})`)
      } else {
        console.error(`[rag-bootstrap] step failed (${label})`)
        failures.push(label)
      }
    }
  }

  if (failures.length > 0) {
    return {
      ok: false,
      reason: `bootstrap failed: ${failures.join(" | ")}`,
      steps: completed,
    }
  }

  return {
    ok: true,
    ranAt: new Date().toISOString(),
    steps: completed,
  }
}

/**
 * Ensure the RAG schema + RPCs exist. Cached per-process: subsequent
 * calls return the same result without touching the database.
 *
 * Force a re-run with `force: true` (used by the manual bootstrap route).
 */
export async function ensureRagSchema(opts: { force?: boolean } = {}): Promise<RagBootstrapResult> {
  if (opts.force) {
    globalThis.__ragBootstrapState = undefined
  }

  if (globalThis.__ragBootstrapState?.result) {
    return globalThis.__ragBootstrapState.result
  }

  if (globalThis.__ragBootstrapState?.promise) {
    return globalThis.__ragBootstrapState.promise
  }

  const promise = runBootstrap().then((result) => {
    if (globalThis.__ragBootstrapState) {
      globalThis.__ragBootstrapState.result = result
    }
    if (result.ok) {
      console.log(
        `[rag-bootstrap] schema verified (${result.steps?.length ?? 0} steps)`,
      )
    } else {
      console.warn(`[rag-bootstrap] failed: ${result.reason}`)
    }
    return result
  })

  globalThis.__ragBootstrapState = { promise }
  return promise
}

/** Read-only accessor for the health endpoint. */
export function getRagBootstrapState(): RagBootstrapResult | "pending" | "not-run" {
  if (!globalThis.__ragBootstrapState) return "not-run"
  if (globalThis.__ragBootstrapState.result) return globalThis.__ragBootstrapState.result
  return "pending"
}
