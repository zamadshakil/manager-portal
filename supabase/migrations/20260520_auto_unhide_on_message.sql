-- ============================================================
-- Rollback: hide-conversation feature removed.
-- Drop the trigger and function if they were previously applied.
-- The hidden_at column on conversation_members is retained
-- (harmless, no UI reads it any more).
-- ============================================================

DROP TRIGGER IF EXISTS unhide_conversation_on_new_message ON public.messages;
DROP FUNCTION IF EXISTS public.unhide_conversation_on_new_message();
