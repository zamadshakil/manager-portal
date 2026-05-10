DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  END IF;
END;
$$;

 ALTER TABLE public.message_reactions REPLICA IDENTITY FULL;

CREATE OR REPLACE FUNCTION public.restore_hidden_conversation_members()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.conversation_members
  SET hidden_at = NULL
  WHERE conversation_id = NEW.conversation_id
    AND user_id <> NEW.sender_id
    AND removed_at IS NULL
    AND hidden_at IS NOT NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS restore_hidden_conversation_members_on_message ON public.messages;
CREATE TRIGGER restore_hidden_conversation_members_on_message
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.restore_hidden_conversation_members();
