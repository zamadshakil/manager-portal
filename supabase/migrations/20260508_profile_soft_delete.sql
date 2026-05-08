-- ============================================================
-- Profile soft-delete: preserves chat history when a user is
-- removed by a main_admin.
-- ============================================================

-- 1. Add deleted_at column to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS profiles_deleted_at_idx
  ON public.profiles (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- 2. Update msg_insert RLS: block sending new messages in a DM
--    where the other participant has been soft-deleted.
DROP POLICY IF EXISTS "msg_insert" ON public.messages;

CREATE POLICY "msg_insert" ON public.messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = messages.conversation_id
        AND cm.user_id = auth.uid()
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.conversations c
      JOIN public.conversation_members cm2 ON cm2.conversation_id = c.id
      JOIN public.profiles p              ON p.id = cm2.user_id
      WHERE c.id   = messages.conversation_id
        AND c.type = 'dm'
        AND cm2.user_id != auth.uid()
        AND p.deleted_at IS NOT NULL
    )
  );

-- 3. Make soft-deleted profiles still visible to conversation
--    members (so message history shows the sender name/avatar).
--    The default profiles RLS (if any) must allow reads of
--    deleted profiles for conversation context.
--    Add a permissive read policy specifically for messaging.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'profiles'
      AND policyname = 'profiles_select_for_messaging'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "profiles_select_for_messaging" ON public.profiles
        FOR SELECT USING (true);
    $policy$;
  END IF;
END
$$;
