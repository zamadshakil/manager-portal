-- Update RLS policies for validation_rules to support global rules (team_id is null)

-- Select: Allow anyone to see global rules (team_id is null)
DROP POLICY IF EXISTS rules_select ON public.validation_rules;
CREATE POLICY rules_select ON public.validation_rules FOR SELECT
  USING (
    public.is_main_admin()
    OR public.is_manager_of(team_id)
    OR team_id = public.current_user_team()
    OR team_id IS NULL
  );

-- Write: Allow main admins and managers to manage rules
DROP POLICY IF EXISTS rules_manager_write ON public.validation_rules;
CREATE POLICY rules_manager_write ON public.validation_rules FOR ALL
  USING (
    public.is_main_admin()
    OR public.is_manager_of(team_id)
    OR team_id = public.current_user_team()
    OR (team_id IS NULL AND public.current_user_role() = 'manager')
  )
  WITH CHECK (
    public.is_main_admin()
    OR public.is_manager_of(team_id)
    OR team_id = public.current_user_team()
    OR (team_id IS NULL AND public.current_user_role() = 'manager')
  );
