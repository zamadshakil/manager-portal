-- ============================================================
-- Messaging: conversations, members, messages, reactions
-- ============================================================

-- ── conversations ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type        text NOT NULL CHECK (type IN ('dm', 'group')),
  name        text,
  created_by  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  avatar_url  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversations_updated_at_idx
  ON public.conversations (updated_at DESC);

-- ── conversation_members ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversation_members (
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at       timestamptz NOT NULL DEFAULT now(),
  last_read_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS cm_user_id_idx
  ON public.conversation_members (user_id);

-- ── messages ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  content          text,
  type             text NOT NULL DEFAULT 'text'
                     CHECK (type IN ('text', 'image', 'file', 'audio', 'video')),
  media_url        text,
  media_metadata   jsonb,
  reply_to_id      uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  edited_at        timestamptz,
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_conv_created_idx
  ON public.messages (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS messages_reply_idx
  ON public.messages (reply_to_id);

-- ── message_reactions ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.message_reactions (
  message_id  uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

-- ── trigger: bump conversations.updated_at on new message ────
CREATE OR REPLACE FUNCTION public.bump_conversation_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.conversations
  SET updated_at = now()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bump_conv_on_message ON public.messages;
CREATE TRIGGER bump_conv_on_message
  AFTER INSERT OR UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.bump_conversation_updated_at();

-- ── enable RLS ───────────────────────────────────────────────
ALTER TABLE public.conversations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reactions    ENABLE ROW LEVEL SECURITY;

-- ── conversations policies ───────────────────────────────────
-- Members can see their conversations
CREATE POLICY "conv_select_member" ON public.conversations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = id
        AND cm.user_id = auth.uid()
    )
  );

-- Creator can insert
CREATE POLICY "conv_insert_creator" ON public.conversations
  FOR INSERT WITH CHECK (created_by = auth.uid());

-- Only conversation admins can update (rename / avatar)
CREATE POLICY "conv_update_admin" ON public.conversations
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = id
        AND cm.user_id = auth.uid()
        AND cm.role = 'admin'
    )
  );

-- ── conversation_members policies ────────────────────────────
CREATE POLICY "cm_select_member" ON public.conversation_members
  FOR SELECT USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.conversation_members cm2
      WHERE cm2.conversation_id = conversation_id
        AND cm2.user_id = auth.uid()
    )
  );

CREATE POLICY "cm_insert_member" ON public.conversation_members
  FOR INSERT WITH CHECK (
    -- Any existing member can add others, or it's their own join
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.conversation_members cm2
      WHERE cm2.conversation_id = conversation_id
        AND cm2.user_id = auth.uid()
    )
  );

CREATE POLICY "cm_update_own" ON public.conversation_members
  FOR UPDATE USING (user_id = auth.uid());

-- Admins can remove members; users can remove themselves
CREATE POLICY "cm_delete" ON public.conversation_members
  FOR DELETE USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.conversation_members cm2
      WHERE cm2.conversation_id = conversation_id
        AND cm2.user_id = auth.uid()
        AND cm2.role = 'admin'
    )
  );

-- ── messages policies ────────────────────────────────────────
-- Conversation members can read non-deleted messages
CREATE POLICY "msg_select" ON public.messages
  FOR SELECT USING (
    deleted_at IS NULL AND
    EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = messages.conversation_id
        AND cm.user_id = auth.uid()
    )
  );

-- Members can insert their own messages
CREATE POLICY "msg_insert" ON public.messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = messages.conversation_id
        AND cm.user_id = auth.uid()
    )
  );

-- Senders can update (edit) their own messages
CREATE POLICY "msg_update_own" ON public.messages
  FOR UPDATE USING (sender_id = auth.uid());

-- Senders can soft-delete (update deleted_at)
CREATE POLICY "msg_delete_own" ON public.messages
  FOR DELETE USING (sender_id = auth.uid());

-- ── message_reactions policies ───────────────────────────────
CREATE POLICY "react_select" ON public.message_reactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.messages m
      JOIN public.conversation_members cm
        ON cm.conversation_id = m.conversation_id
       AND cm.user_id = auth.uid()
      WHERE m.id = message_id
    )
  );

CREATE POLICY "react_insert" ON public.message_reactions
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.messages m
      JOIN public.conversation_members cm
        ON cm.conversation_id = m.conversation_id
       AND cm.user_id = auth.uid()
      WHERE m.id = message_id
    )
  );

CREATE POLICY "react_delete_own" ON public.message_reactions
  FOR DELETE USING (user_id = auth.uid());

-- ── helper RPC: find existing DM between two users ──────────
CREATE OR REPLACE FUNCTION public.find_dm_conversation(user_a uuid, user_b uuid)
RETURNS TABLE(
  id uuid, type text, name text, created_by uuid,
  avatar_url text, created_at timestamptz, updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT c.id, c.type, c.name, c.created_by, c.avatar_url, c.created_at, c.updated_at
  FROM public.conversations c
  WHERE c.type = 'dm'
    AND EXISTS (
      SELECT 1 FROM public.conversation_members WHERE conversation_id = c.id AND user_id = user_a
    )
    AND EXISTS (
      SELECT 1 FROM public.conversation_members WHERE conversation_id = c.id AND user_id = user_b
    )
    AND (
      SELECT COUNT(*) FROM public.conversation_members WHERE conversation_id = c.id
    ) = 2
  LIMIT 1;
$$;

-- ── enable realtime ──────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_members;
