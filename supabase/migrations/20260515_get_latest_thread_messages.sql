-- =============================================================================
-- get_latest_thread_messages RPC
-- Returns the single most-recent message per thread for a given list of
-- thread UUIDs.  Used by /api/smart-ai/threads to batch-fetch last-message
-- previews in one round-trip instead of N queries.
--
-- Caller: supabase.rpc("get_latest_thread_messages", { thread_ids: uuid[] })
-- Returns: rows of (thread_id, role, content, created_at)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_latest_thread_messages(thread_ids uuid[])
RETURNS TABLE(
  thread_id  uuid,
  role       text,
  content    text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT DISTINCT ON (cm.thread_id)
    cm.thread_id,
    cm.role,
    cm.content,
    cm.created_at
  FROM public.chat_messages cm
  WHERE cm.thread_id = ANY(thread_ids)
  ORDER BY cm.thread_id, cm.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_latest_thread_messages(uuid[]) TO authenticated;
