-- ============================================================================
-- Migration 007 — tasks.rule_ids column + submission DELETE policy.
--
-- Audit follow-ups (C2 / C3):
--   * tasks.rule_ids: the application code reads and writes a `rule_ids`
--     column on tasks to restrict which validation rules run for a given
--     task's submissions. The column was never added in any prior migration.
--   * submissions DELETE: RLS enables row level security on submissions but
--     no `for delete` policy existed. Managers and admins who call
--     `deleteSubmission` via the anon-key client got silent 0-row deletes.
--
-- Idempotent: safe to re-run.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Add rule_ids column to tasks (C2)
--    null  → run all enabled team rules (default / backward-compatible)
--    []    → skip all standing rules (only task instructions run)
--    [id…] → run only these specific rules
-- ---------------------------------------------------------------------------
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS rule_ids uuid[] DEFAULT NULL;


-- ---------------------------------------------------------------------------
-- 2. Add submission DELETE RLS policy (C3)
--    Only managers of the submission's team and main_admin may delete.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS submissions_manager_delete ON public.submissions;
CREATE POLICY submissions_manager_delete ON public.submissions FOR DELETE
  USING (
    public.is_main_admin()
    OR public.is_manager_of(team_id)
  );
