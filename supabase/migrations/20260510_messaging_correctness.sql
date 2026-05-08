-- ============================================================
-- Messaging: Phase-2 correctness fixes
--
-- 1. Restrict bump_conv_on_message trigger to INSERT only.
--    Previously it fired on INSERT OR UPDATE, meaning editing
--    or soft-deleting a message would silently bump the
--    conversation's updated_at and push it to the top of
--    every member's sidebar, which is misleading.
-- ============================================================

-- ── 1. Trigger fires on INSERT only ──────────────────────────
-- Drop the existing INSERT OR UPDATE trigger and recreate it
-- as INSERT-only.  The function itself is unchanged.
DROP TRIGGER IF EXISTS bump_conv_on_message ON public.messages;

CREATE TRIGGER bump_conv_on_message
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.bump_conversation_updated_at();
