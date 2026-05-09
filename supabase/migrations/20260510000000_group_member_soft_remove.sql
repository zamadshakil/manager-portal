-- ============================================================
-- Group Member Soft-Remove
--
-- 1. Add removed_at / removed_by to conversation_members so
--    admin kicks are tracked instead of hard-deleted.
-- 2. Rebuild get_conversation_previews to:
--    a) exclude removed members from the caller's visible list
--    b) expose a separate removed_members JSON array
-- ============================================================

-- ── 1. New columns ────────────────────────────────────────────
ALTER TABLE public.conversation_members
  ADD COLUMN IF NOT EXISTS removed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS removed_by  uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Partial index so the common hot-path (active members) is fast
CREATE INDEX IF NOT EXISTS cm_active_idx
  ON public.conversation_members (conversation_id)
  WHERE removed_at IS NULL;

-- ── 2. Rebuild get_conversation_previews ─────────────────────
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
        'user_id',      cm3.user_id,
        'role',         cm3.role,
        'joined_at',    cm3.joined_at,
        'last_read_at', cm3.last_read_at,
        'removed_at',   cm3.removed_at,
        'removed_by',   cm3.removed_by,
        'profile',      json_build_object(
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
    ) AS unread_count

  FROM public.conversations c
  -- Only conversations where the caller is an ACTIVE (not removed) member
  JOIN public.conversation_members cm
    ON cm.conversation_id = c.id
   AND cm.user_id = p_user_id
   AND cm.removed_at IS NULL

  ORDER BY c.updated_at DESC;
$$;

-- Re-grant execute to service_role (required after CREATE OR REPLACE)
GRANT EXECUTE ON FUNCTION public.get_conversation_previews(uuid) TO service_role;
