-- =============================================================================
-- User session tracking for ops monitoring
-- Records login, logout, heartbeat events per user session
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.system_user_sessions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email   TEXT,
  user_role    TEXT,
  session_id   TEXT        NOT NULL,
  event_type   TEXT        NOT NULL
                CHECK (event_type IN ('session_start', 'heartbeat', 'logout', 'login')),
  ip_address   TEXT,
  user_agent   TEXT,
  metadata     JSONB       NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sus_created_at  ON public.system_user_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sus_user_id     ON public.system_user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sus_session_id  ON public.system_user_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_sus_event_type  ON public.system_user_sessions(event_type);

ALTER TABLE public.system_user_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "main_admin_read_user_sessions"
  ON public.system_user_sessions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'main_admin'
    )
  );

-- Auto-purge: keep 30 days of heartbeats, 90 days of login/logout
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'purge-system-user-sessions',
      '0 4 * * *',
      $$DELETE FROM public.system_user_sessions WHERE created_at < now() - INTERVAL '90 days'$$
    );
  END IF;
END;
$$;
