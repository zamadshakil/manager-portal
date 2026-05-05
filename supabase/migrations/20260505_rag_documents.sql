-- Smart AI RAG System Migration
-- Creates the vector extension, rag_documents table, triggers, and search RPCs.

-- 1. Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Create the rag_documents table
CREATE TABLE IF NOT EXISTS rag_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    chunk_index INT NOT NULL DEFAULT 0,
    team_id TEXT,
    owner_id TEXT,
    title TEXT,
    content TEXT NOT NULL,
    embedding vector(1536),
    metadata JSONB DEFAULT '{}'::jsonb,
    tsv tsvector,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. HNSW Index for vector similarity search
CREATE INDEX IF NOT EXISTS rag_documents_embedding_hnsw_idx
ON rag_documents USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- 4. B-Tree Indexes for fast filtering
CREATE INDEX IF NOT EXISTS rag_documents_source_idx
ON rag_documents (source_type, source_id);

CREATE INDEX IF NOT EXISTS rag_documents_owner_idx
ON rag_documents (owner_id);

-- 5. GIN Index for BM25 text search
CREATE INDEX IF NOT EXISTS rag_documents_tsv_idx
ON rag_documents USING GIN (tsv);

-- 6. Trigger to auto-update the tsv column on insert/update
CREATE OR REPLACE FUNCTION rag_documents_tsv_trigger()
RETURNS TRIGGER AS $$
BEGIN
    NEW.tsv := to_tsvector('english', COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.content, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rag_documents_tsv_update ON rag_documents;
CREATE TRIGGER rag_documents_tsv_update
BEFORE INSERT OR UPDATE ON rag_documents
FOR EACH ROW
EXECUTE FUNCTION rag_documents_tsv_trigger();

-- 7. Row Level Security
ALTER TABLE rag_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS documents_owner_all ON rag_documents;
CREATE POLICY documents_owner_all ON rag_documents
    FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- 8. RPC: Vector Similarity Search
CREATE OR REPLACE FUNCTION search_rag_vector(
    query_embedding vector(1536),
    match_limit int,
    filter_owner_id text DEFAULT NULL,
    filter_team_id text DEFAULT NULL,
    filter_role text DEFAULT 'member',
    filter_source_type text DEFAULT NULL,
    filter_source_id text DEFAULT NULL
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
            -- Chat attachments are strictly scoped to the owner
            (filter_source_type = 'chat_attachment' AND d.owner_id = filter_owner_id)
            OR
            -- Other documents follow role-based access
            (
                filter_source_type != 'chat_attachment' AND 
                (
                    (filter_role = 'member' AND d.owner_id = filter_owner_id)
                    OR
                    (filter_role = 'manager' AND (d.team_id = filter_team_id OR d.owner_id = filter_owner_id))
                    OR
                    (filter_role NOT IN ('member', 'manager')) -- e.g., main_admin sees all
                )
            )
            OR
            -- If source type is null, apply the same general rules
            (
                filter_source_type IS NULL AND
                (
                    (d.source_type = 'chat_attachment' AND d.owner_id = filter_owner_id)
                    OR
                    (d.source_type != 'chat_attachment' AND (
                        (filter_role = 'member' AND d.owner_id = filter_owner_id)
                        OR
                        (filter_role = 'manager' AND (d.team_id = filter_team_id OR d.owner_id = filter_owner_id))
                        OR
                        (filter_role NOT IN ('member', 'manager'))
                    ))
                )
            )
        )
        AND (filter_source_type IS NULL OR d.source_type = filter_source_type)
        AND (filter_source_id IS NULL OR d.source_id = filter_source_id)
    ORDER BY d.embedding <=> query_embedding
    LIMIT match_limit;
END;
$$ LANGUAGE plpgsql;

-- 9. RPC: BM25 Full-Text Search
CREATE OR REPLACE FUNCTION search_rag_bm25(
    query_text text,
    match_limit int,
    filter_owner_id text DEFAULT NULL,
    filter_team_id text DEFAULT NULL,
    filter_role text DEFAULT 'member',
    filter_source_type text DEFAULT NULL,
    filter_source_id text DEFAULT NULL
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
                filter_source_type != 'chat_attachment' AND 
                (
                    (filter_role = 'member' AND d.owner_id = filter_owner_id)
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
                    (d.source_type != 'chat_attachment' AND (
                        (filter_role = 'member' AND d.owner_id = filter_owner_id)
                        OR
                        (filter_role = 'manager' AND (d.team_id = filter_team_id OR d.owner_id = filter_owner_id))
                        OR
                        (filter_role NOT IN ('member', 'manager'))
                    ))
                )
            )
        )
        AND (filter_source_type IS NULL OR d.source_type = filter_source_type)
        AND (filter_source_id IS NULL OR d.source_id = filter_source_id)
    ORDER BY score DESC
    LIMIT match_limit;
END;
$$ LANGUAGE plpgsql;
