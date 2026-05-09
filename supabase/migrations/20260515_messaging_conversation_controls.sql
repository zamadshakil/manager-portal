-- ============================================================
-- Messaging: Conversation Controls
--
-- 1. Add cleared_at to conversation_members so each user can
--    independently clear their own chat history view.  The
--    messages/GET route already reads this column; this migration
--    ensures the column actually exists in the database.
--
-- 2. Add hidden_at so users can hide (soft-delete from their
--    sidebar) any conversation without affecting other members.
--
-- 3. Rebuild get_conversation_previews to:
--    a) Only show conversations where the caller is ACTIVE
--       (removed_at IS NULL) — restores the filter that was
--       inadvertently dropped in 20260511_messaging_perf.sql.
--    b) Exclude conversations the caller has hidden (hidden_at IS NULL).
--    c) Return a separate removed_members JSON array so the
--       GroupInfoSheet can display / re-add former members.
--    d) Include removed_at in each member object so the client
--       can distinguish active vs removed members.
-- ============================================================

-- ── 1. cleared_at ────────────────────────────────────────────
ALTER TABLE public.conversation_members
  ADD COLUMN IF NOT EXISTS cleared_at timestamptz;

-- ── 2. hidden_at ─────────────────────────────────────────────
ALTER TABLE public.conversation_members
  ADD COLUMN IF NOT EXISTS hidden_at timestamptz;

-- ── 3. Rebuild get_conversation_previews ─────────────────────
CREATE OR REPLACE FUNCTION public.get_conversation_previews(p_user_id uuid)
RETURNS TABLE(
  id              uuid,
  type            text,
  name            text,
  created_by      uuid,
  avatar_url      text,
  created_at      timestamptz,
  updated_at      timestamptz,
  members         json,
  removed_members json,
  last_message    json,
  unread_count    bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    c.id,
    c.type::text,
    c.name,
    c.created_by,
    c.avatar_url,
    c.created_at,
    c.updated_at,

    -- ── Active members ────────────────────────────────────────
    (
      SELECT json_agg(json_build_object(
        'user_id',      cm2.user_id,
        'role',         cm2.role,
        'joined_at',    cm2.joined_at,
        'last_read_at', cm2.last_read_at,
        'removed_at',   cm2.removed_at,
        'profile',      json_build_object(
          'id',         p.id,
          'full_name',  p.full_name,
          'email',      p.email,
          'avatar_url', p.avatar_url,
          'deleted_at', p.deleted_at
        )
      ))
      FROM public.conversation_members cm2
      JOIN public.profiles p ON p.id = cm2.user_id
      WHERE cm2.conversation_id = c.id
        AND cm2.removed_at IS NULL
    ) AS members,

    -- ── Removed members ───────────────────────────────────────
    (
      SELECT json_agg(json_build_object(
        'user_id',    cm3.user_id,
        'role',       cm3.role,
        'joined_at',  cm3.joined_at,
        'removed_at', cm3.removed_at,
        'removed_by', cm3.removed_by,
        'profile',    json_build_object(
          'id',         p2.id,
          'full_name',  p2.full_name,
          'email',      p2.email,
          'avatar_url', p2.avatar_url,
          'deleted_at', p2.deleted_at
        )
      ))
      FROM public.conversation_members cm3
      JOIN public.profiles p2 ON p2.id = cm3.user_id
      WHERE cm3.conversation_id = c.id
        AND cm3.removed_at IS NOT NULL
    ) AS removed_members,

    -- ── Last message ──────────────────────────────────────────
    (
      SELECT row_to_json(lm)
      FROM (
        SELECT
          id,
          content,
          type::text AS type,
          sender_id,
          created_at,
          deleted_at
        FROM public.messages
        WHERE conversation_id = c.id
          AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      ) lm
    ) AS last_message,

    -- ── Unread count ──────────────────────────────────────────
    (
      SELECT COUNT(*)::bigint
      FROM public.messages m2
      WHERE m2.conversation_id = c.id
        AND m2.deleted_at IS NULL
        AND m2.created_at > COALESCE(cm.last_read_at, '-infinity'::timestamptz)
        AND (cm.cleared_at IS NULL OR m2.created_at > cm.cleared_at)
    ) AS unread_count

  FROM public.conversations c
  -- Only conversations where caller is ACTIVE (not removed, not hidden)
  JOIN public.conversation_members cm
    ON cm.conversation_id = c.id
   AND cm.user_id = p_user_id
   AND cm.removed_at IS NULL
   AND cm.hidden_at IS NULL

  ORDER BY c.updated_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_conversation_previews(uuid) TO service_role;
