WITH ranked AS (
  SELECT
    ctid,
    row_number() OVER (
      PARTITION BY message_id, user_id
      ORDER BY created_at DESC, emoji DESC
    ) AS rn
  FROM public.message_reactions
)
DELETE FROM public.message_reactions mr
USING ranked
WHERE mr.ctid = ranked.ctid
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS message_reactions_one_per_user_idx
  ON public.message_reactions (message_id, user_id);

CREATE OR REPLACE FUNCTION public.toggle_reaction(
  p_message_id uuid,
  p_user_id uuid,
  p_emoji text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_emoji text;
BEGIN
  SELECT emoji INTO v_existing_emoji
  FROM public.message_reactions
  WHERE message_id = p_message_id
    AND user_id = p_user_id
  LIMIT 1;

  IF v_existing_emoji = p_emoji THEN
    DELETE FROM public.message_reactions
    WHERE message_id = p_message_id
      AND user_id = p_user_id;

    RETURN 'removed';
  END IF;

  INSERT INTO public.message_reactions (message_id, user_id, emoji)
  VALUES (p_message_id, p_user_id, p_emoji)
  ON CONFLICT (message_id, user_id)
  DO UPDATE
    SET emoji = EXCLUDED.emoji,
        created_at = now();

  IF v_existing_emoji IS NULL THEN
    RETURN 'added';
  END IF;

  RETURN 'updated';
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_reaction(uuid, uuid, text) TO service_role;
