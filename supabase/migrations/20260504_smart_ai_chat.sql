-- Smart AI Chat System: follow-up migration
-- Adds columns, triggers, RLS, and indexes the application code expects.
-- Idempotent — safe to re-run on Railway Postgres.

-- ---------------------------------------------------------------------------
-- 1. chat_messages.metadata  (§1.3)
-- The MCP persistence layer reads and writes a JSONB metadata column to store
-- tool-call traces, attachment refs, and model name alongside each message.
-- ---------------------------------------------------------------------------
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- 2. chat_threads.updated_at auto-bump trigger  (§1.4)
-- Without this, sorting threads "most recent first" doesn't work because
-- updated_at is only set once at INSERT time.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION bump_thread_updated_at() RETURNS trigger AS $$
BEGIN
  UPDATE chat_threads SET updated_at = NOW() WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS chat_messages_bump_thread ON chat_messages;
CREATE TRIGGER chat_messages_bump_thread
  AFTER INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION bump_thread_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Row Level Security  (§1.5)
-- Per-user scoping: owners can CRUD their own data. Service-role inserts
-- (e.g. from mcp-service) bypass RLS automatically.
-- ---------------------------------------------------------------------------
ALTER TABLE chat_threads   ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_documents ENABLE ROW LEVEL SECURITY;

-- Drop-if-exists so this migration is idempotent.
DROP POLICY IF EXISTS threads_owner_all   ON chat_threads;
DROP POLICY IF EXISTS messages_owner_all  ON chat_messages;
DROP POLICY IF EXISTS documents_owner_all ON chat_documents;

CREATE POLICY threads_owner_all ON chat_threads
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY messages_owner_all ON chat_messages
  FOR ALL USING (
    EXISTS (SELECT 1 FROM chat_threads t
            WHERE t.id = chat_messages.thread_id AND t.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM chat_threads t
            WHERE t.id = chat_messages.thread_id AND t.user_id = auth.uid())
  );

CREATE POLICY documents_owner_all ON chat_documents
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. Performance indexes
-- The original chat-system-database-design SQL may already have user_id /
-- thread_id indexes; these are additive and IF NOT EXISTS keeps it safe.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_chat_threads_user_updated
  ON chat_threads(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_created
  ON chat_messages(thread_id, created_at);

CREATE INDEX IF NOT EXISTS idx_chat_documents_user_created
  ON chat_documents(user_id, created_at DESC);
