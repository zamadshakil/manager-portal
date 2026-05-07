-- Email change verification (admin-initiated email changes for users)
-- ---------------------------------------------------------------------------
-- When a Main Admin updates another user's email from the Edit User modal we
-- do NOT change the auth email immediately. Instead we stash the requested
-- email and a single-use, hashed token on the profile row, and send a link to
-- the NEW address. The user clicks the link, the server validates the token,
-- and only then is the auth.users email + profiles.email actually updated.
--
-- This keeps email changes verifiable (the user proves they own the new
-- mailbox) and gives the UI a clear "Email under verification" state instead
-- of a silent swap that could lock the user out.
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pending_email                 text,
  ADD COLUMN IF NOT EXISTS email_change_token_hash       text,
  ADD COLUMN IF NOT EXISTS email_change_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_change_requested_at     timestamptz,
  ADD COLUMN IF NOT EXISTS email_change_requested_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Lookup index for the confirmation route, which fetches by token hash.
CREATE INDEX IF NOT EXISTS profiles_email_change_token_idx
  ON public.profiles(email_change_token_hash)
  WHERE email_change_token_hash IS NOT NULL;

-- Helpful uniqueness guard: two pending changes shouldn't target the same
-- new address. Partial unique index so only active pending rows are checked.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_pending_email_unique_idx
  ON public.profiles(lower(pending_email))
  WHERE pending_email IS NOT NULL;
