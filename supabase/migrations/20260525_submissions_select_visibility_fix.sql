-- =============================================================================
-- Tighten the submissions_select RLS policy: visibility is bound *only* to
-- `submissions.update` (the "Show all submissions" toggle in the access
-- control UI), not to `submissions.delete`.
-- =============================================================================
-- Background: 20260520_capability_rls_write_policies.sql granted SELECT to a
-- team member who held EITHER `submissions.update` OR `submissions.delete`.
-- The product UI labels `submissions.update` as "Show all submissions" and
-- hides `submissions.delete` from the matrix entirely. The OR clause meant
-- that a user with delete (granted via override or seed) could see every
-- teammate's submission even when "Show all submissions" was inherited deny,
-- making the toggle silently ineffective.
--
-- After this migration:
--   * member with submissions.update -> sees own + teammates' submissions
--   * member without submissions.update -> sees only their own submissions
--   * submissions.delete still authorises the delete action via the
--     submissions_delete policy (unchanged below).
-- =============================================================================

DROP POLICY IF EXISTS submissions_select ON public.submissions;

CREATE POLICY submissions_select ON public.submissions FOR SELECT USING (
  public.is_main_admin()
  OR uploader_id = auth.uid()
  OR public.is_manager_of(team_id)
  -- capability-granted members: all submissions in their own team.
  -- Bound to `submissions.update` only; `submissions.delete` no longer
  -- broadens visibility (see header comment).
  OR (
    team_id = public.current_user_team()
    AND public.has_capability(auth.uid(), 'submissions.update')
  )
);

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
