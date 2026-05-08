-- =============================================================================
-- Validation Rules — capability-driven RLS
-- =============================================================================
-- Replaces the role/team-based policies on `validation_rules` with capability
-- checks resolved via `public.has_capability`. The decision rule (admin >
-- explicit deny > explicit allow > role default) lives in one place; this
-- migration just rewires the table to use it.
--
-- Behaviour:
--   • SELECT  → validation_rules.read   + scope (admin / global / own team)
--   • INSERT  → validation_rules.create + scope (admin or row.team_id matches)
--   • UPDATE  → validation_rules.update + scope (admin or row.team_id matches)
--   • DELETE  → validation_rules.delete + scope (admin or row.team_id matches)
--
-- Members do NOT have validation_rules.* capabilities by default (per the
-- agreed role baseline), so they are blocked at SELECT until the main admin
-- grants them an explicit allow override.
-- =============================================================================

-- Drop the legacy policies created in 20260502153500_fix_global_rules_rls.sql.
DROP POLICY IF EXISTS rules_select         ON public.validation_rules;
DROP POLICY IF EXISTS rules_manager_write  ON public.validation_rules;

-- Read --------------------------------------------------------------------
CREATE POLICY rules_capability_select
    ON public.validation_rules
    FOR SELECT
    USING (
        public.has_capability(auth.uid(), 'validation_rules.read')
        AND (
            public.is_main_admin()
            OR team_id IS NULL
            OR team_id = public.current_user_team()
        )
    );

-- Insert ------------------------------------------------------------------
CREATE POLICY rules_capability_insert
    ON public.validation_rules
    FOR INSERT
    WITH CHECK (
        public.has_capability(auth.uid(), 'validation_rules.create')
        AND (
            public.is_main_admin()
            OR (team_id IS NOT NULL AND team_id = public.current_user_team())
            OR (team_id IS NULL AND public.current_user_role() = 'manager')
        )
    );

-- Update ------------------------------------------------------------------
CREATE POLICY rules_capability_update
    ON public.validation_rules
    FOR UPDATE
    USING (
        public.has_capability(auth.uid(), 'validation_rules.update')
        AND (
            public.is_main_admin()
            OR (team_id IS NOT NULL AND team_id = public.current_user_team())
            OR (team_id IS NULL AND public.current_user_role() = 'manager')
        )
    )
    WITH CHECK (
        public.has_capability(auth.uid(), 'validation_rules.update')
        AND (
            public.is_main_admin()
            OR (team_id IS NOT NULL AND team_id = public.current_user_team())
            OR (team_id IS NULL AND public.current_user_role() = 'manager')
        )
    );

-- Delete ------------------------------------------------------------------
CREATE POLICY rules_capability_delete
    ON public.validation_rules
    FOR DELETE
    USING (
        public.has_capability(auth.uid(), 'validation_rules.delete')
        AND (
            public.is_main_admin()
            OR (team_id IS NOT NULL AND team_id = public.current_user_team())
            OR (team_id IS NULL AND public.current_user_role() = 'manager')
        )
    );

NOTIFY pgrst, 'reload schema';
