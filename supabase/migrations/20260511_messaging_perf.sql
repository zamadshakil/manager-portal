-- ============================================================
-- Messaging: Phase-3 performance improvements
--
-- 1. Partial index on messages so the main chat read path
--    (conversation_id + deleted_at IS NULL + ORDER BY created_at DESC)
--    is covered without scanning deleted rows.
--
-- 2. get_conversation_previews(uuid) RPC collapses the N+1 pattern
--    in GET /api/messaging/conversations into a single DB round-trip.
--    Previously the route fetched the conversation list and then
--    issued TWO extra queries (last_message + unread_count) for EACH
--    conversation, giving 2N extra round trips per sidebar poll.
-- ============================================================

-- ── 1. Partial index ─────────────────────────────────────────
-- Covers:  WHERE conversation_id = $1 AND deleted_at IS NULL
--          ORDER BY created_at DESC
-- Used by: message list pagination, last-message lateral, unread count.
CREATE INDEX IF NOT EXISTS messages_active_conv_idx
  ON public.messages (conversation_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- ── 2. get_conversation_previews ─────────────────────────────
-- Returns every conversation the given user belongs to, ordered by
-- most-recently-updated first.  Each row carries:
--   • full member list with embedded profile objects
--   • last non-deleted message (null if none)
--   • unread count since the caller's last_read_at
-- All aggregation is done in SQL so the caller issues exactly ONE
-- network round-trip regardless of how many conversations exist.
CREATE OR REPLACE FUNCTION public.get_conversation_previews(p_user_id uuid)
RETURNS TABLE(
  id           uuid,
  type         text,
  name         text,
  created_by   uuid,
  avatar_url   text,
  created_at   timestamptz,
  updated_at   timestamptz,
  members      json,
  last_message json,
  unread_count bigint
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

    -- ── Members ───────────────────────────────────────────────
    -- Aggregate every member of this conversation with their
    -- profile data embedded so the sidebar can resolve names/avatars
    -- for DMs and group participant lists without extra fetches.
    (
      SELECT json_agg(json_build_object(
        'user_id',      cm2.user_id,
        'role',         cm2.role,
        'joined_at',    cm2.joined_at,
        'last_read_at', cm2.last_read_at,
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
    ) AS members,

    -- ── Last message ──────────────────────────────────────────
    -- Single most-recent non-deleted message, or NULL.
    -- Uses the partial index added above.
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
    -- Messages newer than the caller's last_read_at that have
    -- not been soft-deleted.
    (
      SELECT COUNT(*)::bigint
      FROM public.messages m2
      WHERE m2.conversation_id = c.id
        AND m2.deleted_at IS NULL
        AND m2.created_at > COALESCE(cm.last_read_at, '-infinity'::timestamptz)
    ) AS unread_count

  FROM public.conversations c
  -- Only conversations the caller is a member of
  JOIN public.conversation_members cm
    ON cm.conversation_id = c.id
   AND cm.user_id = p_user_id

  ORDER BY c.updated_at DESC;
$$;

-- Grant execute so the service-role key (used by createAdminClient) can call it.
-- The function is SECURITY DEFINER so it always runs as the owner (postgres).
GRANT EXECUTE ON FUNCTION public.get_conversation_previews(uuid) TO service_role;
