-- =============================================================================
-- System Observability Tables
-- Phase 1: Request Logs + Error Logs
-- Designed to be OpenTelemetry-compatible (trace_id maps to W3C traceparent)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. system_request_logs
--    Append-only log of every API route call. Written by service-role.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.system_request_logs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id       TEXT,                                           -- W3C traceparent (future OTel migration)
  method         TEXT        NOT NULL,                           -- GET, POST, etc.
  path           TEXT        NOT NULL,                           -- /api/smart-ai/chat
  status_code    INTEGER,                                        -- HTTP status
  duration_ms    INTEGER,                                        -- end-to-end latency
  user_id        UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  ip_address     TEXT,
  user_agent     TEXT,
  error_message  TEXT,                                           -- non-null when status >= 400
  request_size   INTEGER,                                        -- bytes
  response_size  INTEGER,                                        -- bytes
  metadata       JSONB       NOT NULL DEFAULT '{}',              -- arbitrary extra context
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_srl_created_at   ON public.system_request_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_srl_path         ON public.system_request_logs(path);
CREATE INDEX IF NOT EXISTS idx_srl_status_code  ON public.system_request_logs(status_code);
CREATE INDEX IF NOT EXISTS idx_srl_user_id      ON public.system_request_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_srl_trace_id     ON public.system_request_logs(trace_id);

-- ---------------------------------------------------------------------------
-- 2. system_error_logs
--    Structured error records grouped by stable fingerprints.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.system_error_logs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id        TEXT,
  severity        TEXT        NOT NULL DEFAULT 'error'            -- 'error' | 'warning' | 'info'
                  CHECK (severity IN ('error', 'warning', 'info')),
  source          TEXT        NOT NULL DEFAULT 'server'           -- 'api' | 'server' | 'cron' | 'client'
                  CHECK (source IN ('api', 'server', 'cron', 'client', 'pipeline', 'ai')),
  error_message   TEXT        NOT NULL,
  error_code      TEXT,                                           -- NEXT_NOT_FOUND, etc.
  stack_trace     TEXT,
  path            TEXT,
  method          TEXT,
  user_id         UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  ip_address      TEXT,
  fingerprint     TEXT,                                           -- djb2 hash for error grouping (stable across occurrences)
  context         JSONB       NOT NULL DEFAULT '{}',              -- request body, params, etc.
  resolved_at     TIMESTAMPTZ,                                    -- non-null = acknowledged
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sel_created_at   ON public.system_error_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sel_severity     ON public.system_error_logs(severity);
CREATE INDEX IF NOT EXISTS idx_sel_source       ON public.system_error_logs(source);
CREATE INDEX IF NOT EXISTS idx_sel_resolved_at  ON public.system_error_logs(resolved_at);
CREATE INDEX IF NOT EXISTS idx_sel_trace_id     ON public.system_error_logs(trace_id);
CREATE INDEX IF NOT EXISTS idx_sel_fingerprint  ON public.system_error_logs(fingerprint);

-- ---------------------------------------------------------------------------
-- 3. RLS Policies — read: main_admin only; write: service-role only (bypasses RLS)
-- ---------------------------------------------------------------------------
ALTER TABLE public.system_request_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_error_logs   ENABLE ROW LEVEL SECURITY;

-- Only main_admin can read request logs
CREATE POLICY "main_admin_read_request_logs"
  ON public.system_request_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'main_admin'
    )
  );

-- Only main_admin can read error logs
CREATE POLICY "main_admin_read_error_logs"
  ON public.system_error_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'main_admin'
    )
  );

-- main_admin can mark errors as resolved
CREATE POLICY "main_admin_update_error_logs"
  ON public.system_error_logs FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'main_admin'
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Auto-cleanup: retain 90 days of request logs, 180 days of error logs
--    Requires pg_cron extension. If not available, this is a no-op.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'purge-system-request-logs',
      '0 3 * * *',
      $$DELETE FROM public.system_request_logs WHERE created_at < now() - INTERVAL '90 days'$$
    );
    PERFORM cron.schedule(
      'purge-system-error-logs',
      '0 3 * * *',
      $$DELETE FROM public.system_error_logs WHERE created_at < now() - INTERVAL '180 days'$$
    );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Helper view: last-24h summary for the overview dashboard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.system_health_summary AS
SELECT
  (SELECT COUNT(*) FROM public.system_request_logs WHERE created_at > now() - INTERVAL '24 hours')             AS requests_24h,
  (SELECT COUNT(*) FROM public.system_request_logs WHERE created_at > now() - INTERVAL '24 hours' AND status_code >= 400) AS errors_24h,
  (SELECT ROUND(AVG(duration_ms)) FROM public.system_request_logs WHERE created_at > now() - INTERVAL '24 hours')        AS avg_latency_ms_24h,
  (SELECT COUNT(*) FROM public.system_error_logs WHERE created_at > now() - INTERVAL '24 hours')               AS error_events_24h,
  (SELECT COUNT(*) FROM public.system_error_logs WHERE created_at > now() - INTERVAL '24 hours' AND resolved_at IS NULL) AS unresolved_errors_24h,
  (SELECT COUNT(*) FROM public.ai_usage_log WHERE created_at > now() - INTERVAL '24 hours')                    AS ai_calls_24h;
