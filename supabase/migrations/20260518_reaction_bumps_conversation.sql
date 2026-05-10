-- ============================================================
-- Reactions bump conversations.updated_at
--
-- Previously, toggling a reaction left conversations.updated_at
-- unchanged, so the conversation could drop in every member's
-- sidebar after the next fetchConversations() call.
-- Now reactions are treated as conversation activity, exactly
-- like sending a message (bump_conv_on_message trigger).
-- ============================================================

CREATE OR REPLACE FUNCTION public.toggle_reaction(
  p_message_id uuid,
  p_user_id    uuid,
  p_emoji      text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_emoji text;
  v_result         text;
BEGIN
  SELECT emoji INTO v_existing_emoji
  FROM public.message_reactions
  WHERE message_id = p_message_id
    AND user_id    = p_user_id
  LIMIT 1;

  IF v_existing_emoji = p_emoji THEN
    DELETE FROM public.message_reactions
    WHERE message_id = p_message_id
      AND user_id    = p_user_id;

    v_result := 'removed';
  ELSE
    INSERT INTO public.message_reactions (message_id, user_id, emoji)
    VALUES (p_message_id, p_user_id, p_emoji)
    ON CONFLICT (message_id, user_id)
    DO UPDATE
      SET emoji      = EXCLUDED.emoji,
          created_at = now();

    v_result := CASE WHEN v_existing_emoji IS NULL THEN 'added' ELSE 'updated' END;
  END IF;

  -- Bump the conversation so it rises to the top of every member's sidebar,
  -- just as the bump_conv_on_message trigger does for new messages.
  UPDATE public.conversations c
  SET    updated_at = now()
  FROM   public.messages m
  WHERE  m.id = p_message_id
    AND  c.id = m.conversation_id;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_reaction(uuid, uuid, text) TO service_role;
