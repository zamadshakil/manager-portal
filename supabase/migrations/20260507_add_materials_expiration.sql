-- Ensure materials has the expires_at column and indexes
-- =====================================================================

-- 1. Materials Table --------------------------------------------------
ALTER TABLE public.materials 
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS materials_expires_idx 
    ON public.materials(expires_at) 
    WHERE expires_at IS NOT NULL;

-- 2. Refresh Schema Cache ---------------------------------------------
-- This forces PostgREST to pick up the new column immediately.
NOTIFY pgrst, 'reload schema';
