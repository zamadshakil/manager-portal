-- =====================================================================
-- GoTrue Auth Sessions Fix
-- =====================================================================
-- Resolves the 500 error: 
-- "missing destination name refresh_token_hmac_key in *models.Session"
-- 
-- When using self-hosted Supabase (like on Railway), the GoTrue container
-- image can get updated automatically or manually to a newer version that
-- expects certain columns to exist in the `auth.sessions` table, but the 
-- database itself isn't automatically migrated to include them.
--
-- This migration manually adds the missing columns to align the database
-- schema with the expectations of the newer GoTrue container.
-- =====================================================================

ALTER TABLE auth.sessions 
  ADD COLUMN IF NOT EXISTS refresh_token_hmac_key text;

-- Frequently missing alongside refresh_token_hmac_key in recent GoTrue versions
ALTER TABLE auth.sessions 
  ADD COLUMN IF NOT EXISTS oauth_client_id text;
