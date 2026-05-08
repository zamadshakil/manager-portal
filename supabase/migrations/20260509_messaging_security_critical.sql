-- ============================================================
-- Messaging: Phase-1 critical security & correctness hardening
--
-- 1. Harden SECURITY DEFINER functions with an explicit search_path.
-- 2. Denormalize conversation_id onto message_reactions so the Realtime
--    subscription can safely filter by conversation without leaking
--    cross-tenant reaction events.
-- 3. Add an atomic find_or_create_dm RPC (advisory-lock protected) so
--    concurrent "New DM" requests between the same two users can no
--    longer create duplicate DM rows.
--
-- All changes are backwards-compatible: existing rows are backfilled,
-- legacy callers still work, no columns are renamed or dropped.
-- ============================================================

-- ── 1. Lock down SECURITY DEFINER search_path ────────────────
-- Prevents search_path hijack attacks on SECURITY DEFINER funcs.
ALTER FUNCTION public.bump_conversation_updated_at()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.find_dm_conversation(uuid, uuid)
  SET search_path = public, pg_temp;

-- ── 2. Denormalize conversation_id onto message_reactions ────
-- The Realtime publication previously emitted every INSERT/DELETE on
-- message_reactions globally. Without a filter column on the reactions
-- table there was no safe way to scope the subscription per-conversation
-- in the client hook. We add conversation_id, backfill it, keep it in
-- sync via trigger, and index it for fast filtering.
ALTER TABLE public.message_reactions
  ADD COLUMN IF NOT EXISTS conversation_id uuid
    REFERENCES public.conversations(id) ON DELETE CASCADE;

-- Backfill existing reactions from their parent message
UPDATE public.message_reactions mr
SET    conversation_id = m.conversation_id
FROM   public.messages m
WHERE  m.id = mr.message_id
  AND  mr.conversation_id IS NULL;

-- Enforce NOT NULL now that backfill is complete
ALTER TABLE public.message_reactions
  ALTER COLUMN conversation_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS message_reactions_conv_created_idx
  ON public.message_reactions (conversation_id, created_at DESC);

-- Realtime DELETE payloads only include PK columns under REPLICA IDENTITY
-- DEFAULT, so a per-conversation filter on conversation_id would fail to
-- match removals. REPLICA IDENTITY FULL ships the entire row for changes,
-- enabling correct DELETE filtering. The table is small per-row so the
-- WAL overhead is negligible.
ALTER TABLE public.message_reactions REPLICA IDENTITY FULL;

-- Auto-fill conversation_id on INSERT so callers don't have to.
-- Acts as a belt-and-suspenders for any path that inserts directly
-- (including the service-role route handler).
CREATE OR REPLACE FUNCTION public.fill_reaction_conversation_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.conversation_id IS NULL THEN
    SELECT m.conversation_id
      INTO NEW.conversation_id
      FROM public.messages m
     WHERE m.id = NEW.message_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fill_reaction_conv_id ON public.message_reactions;
CREATE TRIGGER fill_reaction_conv_id
  BEFORE INSERT ON public.message_reactions
  FOR EACH ROW EXECUTE FUNCTION public.fill_reaction_conversation_id();

-- ── 3. Atomic find-or-create DM RPC ──────────────────────────
-- Concurrent /api/messaging/conversations POSTs between the same two
-- users previously raced and could create two DM rows. We now take a
-- per-pair advisory lock (hash of the sorted user-id pair) and perform
-- the find-or-create inside a single transaction.
CREATE OR REPLACE FUNCTION public.find_or_create_dm(
  user_a uuid,
  user_b uuid
)
RETURNS TABLE(
  id          uuid,
  type        text,
  name        text,
  created_by  uuid,
  avatar_url  text,
  created_at  timestamptz,
  updated_at  timestamptz,
  was_created boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_low       uuid;
  v_high      uuid;
  v_lock_key  bigint;
  v_conv_id   uuid;
  v_created   boolean := false;
BEGIN
  IF user_a IS NULL OR user_b IS NULL OR user_a = user_b THEN
    RAISE EXCEPTION 'invalid user pair';
  END IF;

  -- Sort the pair so (a,b) and (b,a) take the same lock
  IF user_a < user_b THEN
    v_low  := user_a;
    v_high := user_b;
  ELSE
    v_low  := user_b;
    v_high := user_a;
  END IF;

  -- Derive a stable 64-bit key from the pair for the advisory lock
  v_lock_key := ('x' || substr(md5(v_low::text || ':' || v_high::text), 1, 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Try to find an existing 2-person DM
  SELECT c.id
    INTO v_conv_id
    FROM public.conversations c
   WHERE c.type = 'dm'
     AND EXISTS (SELECT 1 FROM public.conversation_members WHERE conversation_id = c.id AND user_id = v_low)
     AND EXISTS (SELECT 1 FROM public.conversation_members WHERE conversation_id = c.id AND user_id = v_high)
     AND (SELECT COUNT(*) FROM public.conversation_members WHERE conversation_id = c.id) = 2
   LIMIT 1;

  IF v_conv_id IS NULL THEN
    -- Create the DM + both memberships atomically
    INSERT INTO public.conversations (type, created_by)
    VALUES ('dm', user_a)
    RETURNING conversations.id INTO v_conv_id;

    INSERT INTO public.conversation_members (conversation_id, user_id, role)
    VALUES
      (v_conv_id, v_low,  CASE WHEN v_low  = user_a THEN 'admin' ELSE 'member' END),
      (v_conv_id, v_high, CASE WHEN v_high = user_a THEN 'admin' ELSE 'member' END);

    v_created := true;
  END IF;

  RETURN QUERY
  SELECT c.id, c.type, c.name, c.created_by, c.avatar_url,
         c.created_at, c.updated_at, v_created
    FROM public.conversations c
   WHERE c.id = v_conv_id;
END;
$$;
