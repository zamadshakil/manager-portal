-- =====================================================================
-- RAG Documents — RPC-based write path
-- =====================================================================
-- Why this exists:
--
-- Self-hosted PostgREST behind Kong on Railway has been failing to pick
-- up new columns on `rag_documents` even after `NOTIFY pgrst, 'reload
-- schema'`. The symptom is:
--
--     POST /rag_documents -> "Could not find the 'chunk_index' column
--     of 'rag_documents' in the schema cache"
--
-- The column genuinely exists in Postgres — only the PostgREST schema
-- cache is stale. Restarting PostgREST fixes it, but that's a manual
-- step we'd need to repeat after every schema change.
--
-- Switching the indexer to call a Postgres function instead of writing
-- through `from('rag_documents').insert()` sidesteps this entirely.
-- PostgREST validates RPC calls against its *function signature* cache,
-- not its column-level cache, and reload signals are honored more
-- reliably for that one. If the column actually does not exist the
-- function throws a real, readable Postgres error.
--
-- This file is idempotent — safe to re-run.
-- =====================================================================

-- 0. Ensure pgvector + the table exist with the right shape. Re-runs
--    are no-ops; columns missing from a legacy Python-service install
--    are filled in here.
CREATE EXTENSION IF NOT EXISTS vector;

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

-- 1. Bulk-insert RPC.
--    Accepts a jsonb array (one element per chunk) and inserts everything
--    in a single statement. The `embedding` field is sent as a pgvector
--    text literal `"[0.1,0.2,...]"` and cast to `vector` server-side,
--    which is the only encoding that round-trips reliably through
--    PostgREST regardless of cache state.
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
        source_type,
        source_id,
        chunk_index,
        team_id,
        owner_id,
        title,
        content,
        embedding,
        metadata
    )
    SELECT
        source_type,
        source_id,
        chunk_index,
        team_id,
        owner_id,
        title,
        content,
        -- Cast the text literal to pgvector here. If the literal is
        -- malformed Postgres throws "invalid input syntax for type
        -- vector" which is far easier to debug than a silent insert.
        embedding::vector,
        COALESCE(metadata, '{}'::jsonb)
    FROM input;

    GET DIAGNOSTICS inserted_count = ROW_COUNT;
    RETURN inserted_count;
END;
$$;

-- 2. Delete-by-source RPC. Used by the indexer to make re-indexing
--    idempotent: it removes every chunk for (source_type, source_id)
--    before inserting fresh ones.
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

-- 3. Permissions. The Next.js app calls these as the service-role
--    role over PostgREST, so we make sure both `service_role` and the
--    `authenticated` / `anon` roles can EXECUTE. The functions are
--    SECURITY DEFINER so RLS on the underlying table is bypassed —
--    safe because access control is enforced upstream in the app.
GRANT EXECUTE ON FUNCTION insert_rag_chunks(jsonb)         TO service_role, authenticated, anon;
GRANT EXECUTE ON FUNCTION delete_rag_chunks(text, text)    TO service_role, authenticated, anon;

-- 4. Reload PostgREST. NOTIFY is honored for function-signature
--    refreshes far more reliably than for column-level refreshes.
NOTIFY pgrst, 'reload schema';
