-- ============================================================
-- Messaging: Phase-4 UX improvements
--
-- toggle_reaction: atomically adds OR removes a reaction in one
-- DB round-trip instead of the previous SELECT + INSERT/DELETE
-- two-query pattern.  Returns 'added' or 'removed'.
--
-- The fill_reaction_conversation_id BEFORE INSERT trigger
-- (migration 20260509) automatically populates conversation_id,
-- so the INSERT here only needs the three natural-key columns.
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
  v_action text;
BEGIN
  -- Attempt to insert; if the row already exists the ON CONFLICT clause
  -- does nothing and FOUND is false, telling us we need to delete instead.
  INSERT INTO public.message_reactions (message_id, user_id, emoji)
  VALUES (p_message_id, p_user_id, p_emoji)
  ON CONFLICT (message_id, user_id, emoji) DO NOTHING;

  IF FOUND THEN
    v_action := 'added';
  ELSE
    DELETE FROM public.message_reactions
    WHERE message_id = p_message_id
      AND user_id    = p_user_id
      AND emoji      = p_emoji;
    v_action := 'removed';
  END IF;

  RETURN v_action;
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_reaction(uuid, uuid, text) TO service_role;
