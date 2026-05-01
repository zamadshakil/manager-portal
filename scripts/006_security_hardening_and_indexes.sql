-- ============================================================================
-- Migration 006 — Security hardening, performance indexes, and a server-side
-- aggregate for the departments page.
--
-- Idempotent. Safe to re-run.
--
-- Goals:
--   1. Tighten RLS so members cannot read validation rule prompt templates.
--   2. Restore submission ↔ task_assignment consistency when a submission is
--      deleted (the assignment must not stay marked "submitted" with no row).
--   3. Add a SECURITY DEFINER RPC that computes per-team member counts in
--      SQL so the dashboard does not have to ship every profile to the
--      Node runtime to count rows.
--   4. Add covering indexes for the hottest read paths.
--
-- Authorization note for `list_departments_with_stats()`:
--   The function exposes manager full_name and email. We deliberately gate
--   the team-scoped branch on `current_user_role() = 'manager'` so plain
--   members cannot enumerate manager contact info via the RPC, even though
--   `current_user_team()` would otherwise resolve their team for them.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Tighten validation_rules SELECT — members must NOT read rule prompts.
--    The previous policy let any authenticated user whose team_id matched
--    read prompt_template, leaking the AI grading rubric.
-- ---------------------------------------------------------------------------
drop policy if exists rules_select on public.validation_rules;
create policy rules_select on public.validation_rules for select
  using (
    public.is_main_admin()
    or public.is_manager_of(team_id)
  );


-- ---------------------------------------------------------------------------
-- 2. Submission ↔ task_assignment integrity:
--    If a submission row is deleted, any task_assignment that pointed at it
--    is left with status='submitted' and submission_id=NULL — a phantom
--    "submitted on time" with no underlying file. Flip it back so reports
--    don't lie.
-- ---------------------------------------------------------------------------
create or replace function public.reset_assignment_on_submission_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only reset rows that were pointing at the deleted submission. We pick
  -- 'assigned' (rather than 'missed') so the cron / member can decide based
  -- on the task's due_at whether it has now lapsed.
  update public.task_assignments
     set status = 'assigned',
         submitted_at = null,
         late_reason = null
   where submission_id = old.id;
  return old;
end;
$$;

drop trigger if exists submissions_reset_assignment on public.submissions;
create trigger submissions_reset_assignment
  before delete on public.submissions
  for each row execute function public.reset_assignment_on_submission_delete();


-- ---------------------------------------------------------------------------
-- 3. SQL aggregate replacement for `listDepartmentsWithStats`. Returning a
--    set lets the caller `from(...).select('*')` it through PostgREST.
--
--    SECURITY DEFINER: bypasses RLS so the join is efficient. We re-impose
--    authorization in the WHERE clause:
--      - main_admin: all teams
--      - manager:    only their own team
--      - member:     nothing (no rows)
-- ---------------------------------------------------------------------------
create or replace function public.list_departments_with_stats()
returns table (
  id uuid,
  name text,
  description text,
  manager_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  manager_full_name text,
  manager_email text,
  member_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id,
    t.name,
    t.description,
    t.manager_id,
    t.created_at,
    t.updated_at,
    p.full_name as manager_full_name,
    p.email as manager_email,
    (
      select count(*) from public.profiles mp
      where mp.team_id = t.id
    ) as member_count
  from public.teams t
  left join public.profiles p on p.id = t.manager_id
  -- Only main_admin sees the cross-team directory; managers see their own
  -- team. Members are excluded entirely so the manager-contact columns are
  -- never returned to them. (Per Copilot review — `current_user_team()`
  -- alone would have leaked the row to the manager's own members.)
  where public.is_main_admin()
     or (
       public.current_user_role() = 'manager'
       and t.id = public.current_user_team()
     )
  order by t.name asc;
$$;

revoke all on function public.list_departments_with_stats() from public;
grant execute on function public.list_departments_with_stats() to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Performance indexes for the hottest read paths.
-- ---------------------------------------------------------------------------
-- Latest-first runs per submission (Reports drawer, debug pages).
create index if not exists idx_validation_runs_submission_created
  on public.validation_runs (submission_id, created_at desc);

-- mark-missed cron: filters task_assignments by status='assigned'.
create index if not exists idx_task_assignments_assigned
  on public.task_assignments (status)
  where status = 'assigned';

-- FK columns without indexes hurt cascades. tasks.manager_id wasn't covered.
create index if not exists idx_tasks_manager_id
  on public.tasks (manager_id);

-- listSubmissions paginates by (created_at desc, id desc) — make the index
-- match for stable cursor pagination across millisecond ties.
create index if not exists idx_submissions_team_created_id
  on public.submissions (team_id, created_at desc, id desc);
