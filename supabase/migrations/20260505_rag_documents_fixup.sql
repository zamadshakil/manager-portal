-- =====================================================================
-- RAG Documents Schema Fixup
-- =====================================================================
-- Idempotent reconciliation for `rag_documents`. Run this after the base
-- migration (`20260505_rag_documents.sql`) on any environment where the
-- table may have been created earlier by a different service (e.g. the
-- legacy FastAPI rag-service that auto-bootstrapped its own DDL).
--
-- Symptom this fixes:
--   POST /rag_documents -> "Could not find the 'chunk_index' column of
--   'rag_documents' in the schema cache"
--
-- Causes:
--   1. An older version of the table exists and is missing one or more
--      columns the indexer expects. CREATE TABLE IF NOT EXISTS in the
--      base migration is then a no-op and never adds them.
--   2. PostgREST cached the schema before the migration ran and is
--      still serving the old snapshot.
--
-- Safe to re-run any number of times.
-- =====================================================================

-- 0. Ensure pgvector is available (no-op if already enabled).
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Add every column the indexer/retriever expect, idempotently.
--    Uses ADD COLUMN IF NOT EXISTS so existing rows are preserved.
ALTER TABLE rag_documents
    ADD COLUMN IF NOT EXISTS source_type   TEXT,
    ADD COLUMN IF NOT EXISTS source_id     TEXT,
    ADD COLUMN IF NOT EXISTS chunk_index   INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS team_id       TEXT,
    ADD COLUMN IF NOT EXISTS owner_id      TEXT,
    ADD COLUMN IF NOT EXISTS title         TEXT,
    ADD COLUMN IF NOT EXISTS content       TEXT,
    ADD COLUMN IF NOT EXISTS embedding     vector(1536),
    ADD COLUMN IF NOT EXISTS metadata      JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS tsv           tsvector,
    ADD COLUMN IF NOT EXISTS created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 2. Tighten NOT NULL constraints where the base migration declared them,
--    but only after the columns are guaranteed to exist.
DO $$
BEGIN
    -- source_type / source_id / content are NOT NULL in the base schema.
    -- We only flip the constraint on if no NULL rows exist, otherwise
    -- the ALTER would fail on legacy data.
    IF NOT EXISTS (SELECT 1 FROM rag_documents WHERE source_type IS NULL) THEN
        ALTER TABLE rag_documents ALTER COLUMN source_type SET NOT NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM rag_documents WHERE source_id IS NULL) THEN
        ALTER TABLE rag_documents ALTER COLUMN source_id SET NOT NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM rag_documents WHERE content IS NULL) THEN
        ALTER TABLE rag_documents ALTER COLUMN content SET NOT NULL;
    END IF;
END$$;

-- 3. Recreate the indexes the base migration declares (no-ops if present).
CREATE INDEX IF NOT EXISTS rag_documents_embedding_hnsw_idx
    ON rag_documents USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS rag_documents_source_idx
    ON rag_documents (source_type, source_id);

CREATE INDEX IF NOT EXISTS rag_documents_owner_idx
    ON rag_documents (owner_id);

CREATE INDEX IF NOT EXISTS rag_documents_tsv_idx
    ON rag_documents USING GIN (tsv);

-- 4. Recreate the tsv trigger (CREATE OR REPLACE handles drift).
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
    EXECUTE FUNCTION rag_documents_tsv_trigger();

-- 5. Backfill tsv for any pre-existing rows that have NULL tsv.
UPDATE rag_documents
SET tsv = to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(content, ''))
WHERE tsv IS NULL;

-- 6. Force PostgREST to reload its schema cache so the API immediately
--    sees the columns above. This is the second half of the fix.
NOTIFY pgrst, 'reload schema';
