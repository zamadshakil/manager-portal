-- Smart AI Chat — follow-up migration
-- =====================================================================
-- Run this AFTER chat-system-database-design (which created chat_threads,
-- chat_messages, chat_documents). It adds the columns, indexes, triggers,
-- and Row Level Security policies the application code relies on.
--
-- All statements are idempotent — safe to re-run.
-- =====================================================================

-- 1. chat_messages.metadata --------------------------------------------
--    Stores attachment references, tool call traces, and other per-turn
--    context the persistence layer (mcp-service/persistence.ts) writes.

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 2. chat_documents.text_excerpt + indexed_at ---------------------------
--    Caches the parsed text so the materials tab and quick-preview UI
--    don't have to re-fetch / re-parse from R2. Also tracks when the
--    RAG pipeline last embedded the row.

ALTER TABLE chat_documents
  ADD COLUMN IF NOT EXISTS text_excerpt TEXT,
  ADD COLUMN IF NOT EXISTS indexed_at   TIMESTAMP WITH TIME ZONE;

-- 3. chat_threads.updated_at trigger -----------------------------------
--    Keeps thread.updated_at fresh whenever a new message is appended,
--    so the future thread-list UI can sort by last activity.

CREATE OR REPLACE FUNCTION touch_chat_thread() RETURNS TRIGGER AS $$
BEGIN
  UPDATE chat_threads
     SET updated_at = NOW()
   WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS chat_messages_touch_thread ON chat_messages;
CREATE TRIGGER chat_messages_touch_thread
  AFTER INSERT ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION touch_chat_thread();

-- 4. Row Level Security -------------------------------------------------
--    Per-user only. Members own their threads, messages, and uploaded
--    documents. The mcp-service uses the service-role key to bypass
--    these policies for trusted server-side persistence; the Next.js
--    portal uses the user's JWT so RLS is enforced for direct reads.

ALTER TABLE chat_threads   ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_documents ENABLE ROW LEVEL SECURITY;

-- chat_threads ----------------------------------------------------------
DROP POLICY IF EXISTS "chat_threads_select_own" ON chat_threads;
CREATE POLICY "chat_threads_select_own" ON chat_threads
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "chat_threads_insert_own" ON chat_threads;
CREATE POLICY "chat_threads_insert_own" ON chat_threads
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "chat_threads_update_own" ON chat_threads;
CREATE POLICY "chat_threads_update_own" ON chat_threads
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "chat_threads_delete_own" ON chat_threads;
CREATE POLICY "chat_threads_delete_own" ON chat_threads
  FOR DELETE USING (auth.uid() = user_id);

-- chat_messages ---------------------------------------------------------
-- Scoped through the parent thread so we don't have to denormalize user_id.
DROP POLICY IF EXISTS "chat_messages_select_own" ON chat_messages;
CREATE POLICY "chat_messages_select_own" ON chat_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM chat_threads t
       WHERE t.id = chat_messages.thread_id
         AND t.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "chat_messages_insert_own" ON chat_messages;
CREATE POLICY "chat_messages_insert_own" ON chat_messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM chat_threads t
       WHERE t.id = chat_messages.thread_id
         AND t.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "chat_messages_delete_own" ON chat_messages;
CREATE POLICY "chat_messages_delete_own" ON chat_messages
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM chat_threads t
       WHERE t.id = chat_messages.thread_id
         AND t.user_id = auth.uid()
    )
  );

-- chat_documents --------------------------------------------------------
DROP POLICY IF EXISTS "chat_documents_select_own" ON chat_documents;
CREATE POLICY "chat_documents_select_own" ON chat_documents
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "chat_documents_insert_own" ON chat_documents;
CREATE POLICY "chat_documents_insert_own" ON chat_documents
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "chat_documents_update_own" ON chat_documents;
CREATE POLICY "chat_documents_update_own" ON chat_documents
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "chat_documents_delete_own" ON chat_documents;
CREATE POLICY "chat_documents_delete_own" ON chat_documents
  FOR DELETE USING (auth.uid() = user_id);

-- 5. Helpful indexes ----------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_created
  ON chat_messages (thread_id, created_at);

CREATE INDEX IF NOT EXISTS idx_chat_documents_user_created
  ON chat_documents (user_id, created_at DESC);

-- 6. pgvector / RAG bootstrap (idempotent) -----------------------------
--    The FastAPI rag-service also runs these on boot, but having them in
--    a versioned SQL file means the schema is reproducible without the
--    service being live.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS rag_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  team_id     TEXT,
  owner_id    TEXT,
  title       TEXT,
  content     TEXT NOT NULL,
  embedding   vector(1536),
  metadata    JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS rag_documents_source_uniq
  ON rag_documents (source_type, source_id);

CREATE INDEX IF NOT EXISTS rag_documents_team_idx  ON rag_documents (team_id);
CREATE INDEX IF NOT EXISTS rag_documents_owner_idx ON rag_documents (owner_id);

-- HNSW would be the better long-term choice (no ANALYZE step), but ivfflat
-- is fine while the corpus is small. Re-run ANALYZE after large bulk loads.
CREATE INDEX IF NOT EXISTS rag_documents_embedding_idx
  ON rag_documents USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE TABLE IF NOT EXISTS rag_query_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  role        TEXT NOT NULL,
  team_id     TEXT,
  question    TEXT NOT NULL,
  sources     INT  NOT NULL DEFAULT 0,
  latency_ms  INT  NOT NULL DEFAULT 0,
  tokens_in   INT  NOT NULL DEFAULT 0,
  tokens_out  INT  NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rag_query_log_created_idx
  ON rag_query_log (created_at DESC);
