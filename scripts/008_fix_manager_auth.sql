-- ============================================================================
-- Fix `is_manager_of` function to correctly check if the user is a manager of the target team
-- by checking their profile `role` and `team_id`, rather than relying on `teams.manager_id`.
-- This ensures managers can see all assignments for their team.
-- ============================================================================

create or replace function public.is_manager_of(target_team uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'manager' and team_id = target_team
  )
  or (select role from public.profiles where id = auth.uid()) = 'main_admin';
$$;
