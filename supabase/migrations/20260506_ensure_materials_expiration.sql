-- Ensure materials and announcements have the expires_at column and indexes
-- =====================================================================

-- 1. Materials Table --------------------------------------------------
ALTER TABLE public.materials 
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS materials_expires_idx 
    ON public.materials(expires_at) 
    WHERE expires_at IS NOT NULL;

-- 2. Announcements Table -----------------------------------------------
-- (Usually already exists but ensuring it for completeness)
ALTER TABLE public.announcements 
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS announcements_expires_idx 
    ON public.announcements(expires_at) 
    WHERE expires_at IS NOT NULL;

-- 3. Refresh Schema Cache ---------------------------------------------
-- This forces PostgREST to pick up the new column immediately.
NOTIFY pgrst, 'reload schema';
