-- ============================================================================
-- Migration: fix member task visibility
--
-- Problem: the previous `tasks_select` RLS policy allowed any team member
-- to read ALL tasks in their team, regardless of whether they were assigned.
-- This meant an unassigned member could navigate directly to a task URL and
-- see its metadata.
--
-- Fix: narrow the member clause so a member can only read tasks they have
-- an explicit row in `task_assignments` for.
-- Managers and main_admin visibility is unchanged.
-- ============================================================================

drop policy if exists tasks_select on public.tasks;

create policy tasks_select on public.tasks for select using (
  public.current_user_role() = 'main_admin'
  or (public.current_user_role() = 'manager' and public.is_manager_of(team_id))
  or (
    public.current_user_role() = 'member'
    and exists (
      select 1
      from public.task_assignments ta
      where ta.task_id = id
        and ta.assignee_id = (select auth.uid())
    )
  )
);
