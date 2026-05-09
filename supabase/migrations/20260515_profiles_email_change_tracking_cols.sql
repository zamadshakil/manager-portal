-- Add missing email-change tracking columns that were appended to
-- 20260507_email_change_verification.sql after it had already been applied.
-- Using ADD COLUMN IF NOT EXISTS so this is safe to re-run.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_change_requested_at  timestamptz,
  ADD COLUMN IF NOT EXISTS email_change_requested_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
