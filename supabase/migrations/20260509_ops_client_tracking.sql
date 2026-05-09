-- =============================================================================
-- Client-side observability: page views + user activity
-- Written by /api/ops/ingest via service-role (bypasses RLS)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.system_page_views (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email   TEXT,
  session_id   TEXT,
  pathname     TEXT        NOT NULL,
  referrer     TEXT,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spv_created_at ON public.system_page_views(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_spv_user_id    ON public.system_page_views(user_id);
CREATE INDEX IF NOT EXISTS idx_spv_pathname   ON public.system_page_views(pathname);

ALTER TABLE public.system_page_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "main_admin_read_page_views"
  ON public.system_page_views FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'main_admin'
    )
  );
