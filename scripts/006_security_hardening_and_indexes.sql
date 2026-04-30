-- ============================================================================
-- Migration 006 — Security hardening and performance indexes.
--
-- Audit follow-ups (P0 / P1):
--   * task_assignments_member_self lets members self-mark status=submitted.
--     Drop it: members go through the server action which uses the service
--     role for the authoritative status transition (after the action verifies
--     the deadline/uploader). Defense in depth lives at the action boundary.
--   * rules_select leaks prompt_template to members. Tighten to managers/admin.
--   * Deleting a submission left task_assignments in 'submitted' state with no
--     underlying file. Add a trigger to flip it back to 'assigned'.
--   * Missing FK / partial indexes on tasks.manager_id, validation_runs lookups,
--     and the active-assignments scan that the cron job runs.
--   * listDepartmentsWithStats fetched every profile to compute per-team
--     counts. Replace with a SECURITY DEFINER function that aggregates in SQL.
--
-- Idempotent: re-runnable on a partially-applied database.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Drop member self-update policy on task_assignments
--    Members never update task_assignments directly via the anon client now —
--    the server action (`createSubmission`) writes the assignment row through
--    the service-role client after verifying ownership and deadline.
-- ---------------------------------------------------------------------------
drop policy if exists task_assignments_member_self on public.task_assignments;


-- ---------------------------------------------------------------------------
-- 2. Tighten validation_rules SELECT so members cannot read prompt templates.
--    Only managers of the rule's team and main_admin should see them.
-- ---------------------------------------------------------------------------
drop policy if exists rules_select on public.validation_rules;
create policy rules_select on public.validation_rules for select
  using (
    public.is_main_admin()
    or public.is_manager_of(team_id)
  );


-- ---------------------------------------------------------------------------
-- 3. When a submission row is deleted, reset its parent task_assignment back
--    to 'assigned' so the member can re-submit and the manager dashboard
--    doesn't show a "submitted" assignment with no file.
-- ---------------------------------------------------------------------------
create or replace function public.reset_assignment_on_submission_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.task_assignment_id is not null then
    update public.task_assignments
       set status = 'assigned',
           submission_id = null,
           submitted_at = null,
           late_reason = null
     where id = old.task_assignment_id;
  end if;
  return old;
end $$;

drop trigger if exists submissions_reset_assignment on public.submissions;
create trigger submissions_reset_assignment
  before delete on public.submissions
  for each row execute function public.reset_assignment_on_submission_delete();


-- ---------------------------------------------------------------------------
-- 4. Performance indexes
-- ---------------------------------------------------------------------------

-- "latest runs for a submission" pattern in the validation pipeline + UI.
create index if not exists idx_validation_runs_submission_created
  on public.validation_runs (submission_id, created_at desc);

-- FK column without an index — slow for cascades and "tasks I created" queries.
create index if not exists idx_tasks_manager
  on public.tasks (manager_id);

-- The mark-missed cron scans only 'assigned' rows; a partial index keeps it
-- index-only as the table grows.
create index if not exists idx_task_assignments_active
  on public.task_assignments (created_at desc)
  where status = 'assigned';

-- listSubmissions uses (created_at desc, id desc) tuple pagination now —
-- this composite index supports both single-team and tenant-wide pages.
create index if not exists idx_submissions_team_created_id
  on public.submissions (team_id, created_at desc, id desc);


-- ---------------------------------------------------------------------------
-- 5. SQL-side aggregation for the Departments dashboard.
--    Returns one row per team with the manager profile and member count
--    pre-computed, so the UI doesn't have to fetch every profile.
-- ---------------------------------------------------------------------------
create or replace function public.list_departments_with_stats()
returns table (
  id           uuid,
  name         text,
  description  text,
  manager_id   uuid,
  created_at   timestamptz,
  updated_at   timestamptz,
  manager_full_name text,
  manager_email     text,
  member_count int
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
    p.email     as manager_email,
    coalesce(mc.cnt, 0)::int as member_count
  from public.teams t
  left join public.profiles p on p.id = t.manager_id
  left join (
    select team_id, count(*)::int as cnt
    from public.profiles
    where team_id is not null
    group by team_id
  ) mc on mc.team_id = t.id
  -- Only main_admin should see the cross-team directory; managers see their
  -- own team. This mirrors the page-level authorization gate.
  where public.is_main_admin()
     or t.id = public.current_user_team()
     or t.manager_id = auth.uid()
  order by t.name asc;
$$;

revoke all on function public.list_departments_with_stats() from public;
grant execute on function public.list_departments_with_stats() to authenticated;
