-- =====================================================================
-- RAG FULL SETUP — single, idempotent, copy-paste-into-psql script
-- =====================================================================
-- Use this when Supabase Studio is unreachable (e.g. Railway returning
-- "Application failed to respond"). Connect directly to the Postgres
-- service with any client (psql, TablePlus, DBeaver, pgAdmin) using the
-- DATABASE_URL exposed by the `Postgres` Railway service and run this
-- whole file in one go.
--
-- It bundles, in order:
--   * pgvector extension
--   * rag_documents table (create-if-missing, with column repair)
--   * indexes (HNSW + GIN + B-Tree)
--   * tsv trigger
--   * RLS + owner policy
--   * search_rag_vector / search_rag_bm25 RPCs (READ path)
--   * insert_rag_chunks / delete_rag_chunks RPCs (WRITE path)
--   * GRANTs for service_role / authenticated / anon
--   * NOTIFY pgrst, 'reload schema'   (twice — once mid-file, once at end)
--
-- Safe to re-run any number of times. After it finishes, the
-- "Could not find the function public.insert_rag_chunks(rows) in the
-- schema cache" error will be gone, and PDF/file uploads will index
-- correctly.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- for gen_random_uuid()

-- ---------------------------------------------------------------------
-- 1. Table — create if missing
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rag_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
);

-- ---------------------------------------------------------------------
-- 2. Column repair — add anything missing on legacy installs
--    (CREATE TABLE IF NOT EXISTS above is a no-op when the table
--     already exists from an older service like the Python rag-service.)
-- ---------------------------------------------------------------------
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

-- Tighten NOT NULLs only if data permits (legacy rows may be NULL).
DO $$
BEGIN
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

-- ---------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS rag_documents_embedding_hnsw_idx
    ON rag_documents USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS rag_documents_source_idx
    ON rag_documents (source_type, source_id);

CREATE INDEX IF NOT EXISTS rag_documents_owner_idx
    ON rag_documents (owner_id);

CREATE INDEX IF NOT EXISTS rag_documents_tsv_idx
    ON rag_documents USING GIN (tsv);

-- ---------------------------------------------------------------------
-- 4. tsv trigger
-- ---------------------------------------------------------------------
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

-- Backfill tsv for any pre-existing rows.
UPDATE rag_documents
SET tsv = to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(content, ''))
WHERE tsv IS NULL;

-- ---------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------
ALTER TABLE rag_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS documents_owner_all ON rag_documents;
CREATE POLICY documents_owner_all ON rag_documents
    FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- Mid-file reload so subsequent function CREATEs see the table cleanly.
NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- 6. Search RPCs (read path)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search_rag_vector(
    query_embedding   vector(1536),
    match_limit       int,
    filter_owner_id   text DEFAULT NULL,
    filter_team_id    text DEFAULT NULL,
    filter_role       text DEFAULT 'member',
    filter_source_type text DEFAULT NULL,
    filter_source_id  text DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    source_type text,
    source_id text,
    title text,
    snippet text,
    metadata jsonb,
    score float
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        d.id,
        d.source_type,
        d.source_id,
        d.title,
        LEFT(d.content, 800) AS snippet,
        d.metadata,
        1 - (d.embedding <=> query_embedding) AS score
    FROM rag_documents d
    WHERE
        (
            (filter_source_type = 'chat_attachment' AND d.owner_id = filter_owner_id)
            OR
            (
                filter_source_type IS NOT NULL AND filter_source_type <> 'chat_attachment' AND
                (
                    (filter_role = 'member'  AND d.owner_id = filter_owner_id)
                    OR
                    (filter_role = 'manager' AND (d.team_id = filter_team_id OR d.owner_id = filter_owner_id))
                    OR
                    (filter_role NOT IN ('member', 'manager'))
                )
            )
            OR
            (
                filter_source_type IS NULL AND
                (
                    (d.source_type = 'chat_attachment' AND d.owner_id = filter_owner_id)
                    OR
                    (d.source_type <> 'chat_attachment' AND (
                        (filter_role = 'member'  AND d.owner_id = filter_owner_id)
                        OR
                        (filter_role = 'manager' AND (d.team_id = filter_team_id OR d.owner_id = filter_owner_id))
                        OR
                        (filter_role NOT IN ('member', 'manager'))
                    ))
                )
            )
        )
        AND (filter_source_type IS NULL OR d.source_type = filter_source_type)
        AND (filter_source_id   IS NULL OR d.source_id   = filter_source_id)
    ORDER BY d.embedding <=> query_embedding
    LIMIT match_limit;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION search_rag_bm25(
    query_text        text,
    match_limit       int,
    filter_owner_id   text DEFAULT NULL,
    filter_team_id    text DEFAULT NULL,
    filter_role       text DEFAULT 'member',
    filter_source_type text DEFAULT NULL,
    filter_source_id  text DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    source_type text,
    source_id text,
    title text,
    snippet text,
    metadata jsonb,
    score float
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        d.id,
        d.source_type,
        d.source_id,
        d.title,
        LEFT(d.content, 800) AS snippet,
        d.metadata,
        ts_rank_cd(d.tsv, plainto_tsquery('english', query_text))::float AS score
    FROM rag_documents d
    WHERE
        d.tsv @@ plainto_tsquery('english', query_text)
        AND (
            (filter_source_type = 'chat_attachment' AND d.owner_id = filter_owner_id)
            OR
            (
                filter_source_type IS NOT NULL AND filter_source_type <> 'chat_attachment' AND
                (
                    (filter_role = 'member'  AND d.owner_id = filter_owner_id)
                    OR
                    (filter_role = 'manager' AND (d.team_id = filter_team_id OR d.owner_id = filter_owner_id))
                    OR
                    (filter_role NOT IN ('member', 'manager'))
                )
            )
            OR
            (
                filter_source_type IS NULL AND
                (
                    (d.source_type = 'chat_attachment' AND d.owner_id = filter_owner_id)
                    OR
                    (d.source_type <> 'chat_attachment' AND (
                        (filter_role = 'member'  AND d.owner_id = filter_owner_id)
                        OR
                        (filter_role = 'manager' AND (d.team_id = filter_team_id OR d.owner_id = filter_owner_id))
                        OR
                        (filter_role NOT IN ('member', 'manager'))
                    ))
                )
            )
        )
        AND (filter_source_type IS NULL OR d.source_type = filter_source_type)
        AND (filter_source_id   IS NULL OR d.source_id   = filter_source_id)
    ORDER BY score DESC
    LIMIT match_limit;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- 7. Write RPCs — THE ONES YOU ARE MISSING IN PRODUCTION
-- ---------------------------------------------------------------------
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
$$;

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
$$;

-- ---------------------------------------------------------------------
-- 8. Permissions
-- ---------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION insert_rag_chunks(jsonb)            TO service_role, authenticated, anon;
GRANT EXECUTE ON FUNCTION delete_rag_chunks(text, text)       TO service_role, authenticated, anon;
GRANT EXECUTE ON FUNCTION search_rag_vector(vector, int, text, text, text, text, text)
                                                              TO service_role, authenticated, anon;
GRANT EXECUTE ON FUNCTION search_rag_bm25(text, int, text, text, text, text, text)
                                                              TO service_role, authenticated, anon;

-- ---------------------------------------------------------------------
-- 9. Force PostgREST to refresh its cache so the API picks up
--    the new functions and columns immediately.
-- ---------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- 10. Verification (optional — safe to run interactively).
--     These should all return rows / 'exists'=true.
-- ---------------------------------------------------------------------
-- SELECT proname FROM pg_proc WHERE proname IN
--   ('insert_rag_chunks','delete_rag_chunks','search_rag_vector','search_rag_bm25');
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name='rag_documents' ORDER BY ordinal_position;
-- SELECT COUNT(*) FROM rag_documents;
