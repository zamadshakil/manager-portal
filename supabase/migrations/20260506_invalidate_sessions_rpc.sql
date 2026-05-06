-- =====================================================================
-- RPC for Invalidation of Active Sessions
-- =====================================================================
-- Used to terminate user sessions in real-time when a user is demoted,
-- preventing exploitation of cached session permissions.

CREATE OR REPLACE FUNCTION invalidate_user_sessions(target_user_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  -- Delete all refresh tokens associated with the user's sessions
  DELETE FROM auth.refresh_tokens 
  WHERE session_id IN (
    SELECT id FROM auth.sessions WHERE user_id = target_user_id
  );

  -- Delete all active sessions for the user
  DELETE FROM auth.sessions 
  WHERE user_id = target_user_id;
$$;
