-- Add per-member cleared_at timestamp for "Clear Chat History" feature.
-- NULL means "show all messages" (preserves existing behaviour).
-- Setting this to NOW() for a member hides messages older than that point
-- for that user only — no data is deleted from the messages table.

ALTER TABLE public.conversation_members
  ADD COLUMN IF NOT EXISTS cleared_at timestamptz;
