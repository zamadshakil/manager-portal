-- Base tables for chat persistence
-- =====================================================================
-- Run this in your Supabase SQL Editor to enable stateful AI conversations.
-- These tables store the thread history and message context.
-- =====================================================================

CREATE TABLE IF NOT EXISTS chat_threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT DEFAULT 'New conversation',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_chat_threads_user_id ON chat_threads(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_id ON chat_messages(thread_id);

-- Enable RLS
ALTER TABLE chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Thread RLS (Owner only)
DROP POLICY IF EXISTS threads_owner_all ON chat_threads;
CREATE POLICY threads_owner_all ON chat_threads
    FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Message RLS (Scoped via thread owner)
DROP POLICY IF EXISTS messages_owner_all ON chat_messages;
CREATE POLICY messages_owner_all ON chat_messages
    FOR ALL USING (
        EXISTS (SELECT 1 FROM chat_threads t WHERE t.id = chat_messages.thread_id AND t.user_id = auth.uid())
    ) WITH CHECK (
        EXISTS (SELECT 1 FROM chat_threads t WHERE t.id = chat_messages.thread_id AND t.user_id = auth.uid())
    );
