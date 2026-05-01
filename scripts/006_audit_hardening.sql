-- ============================================================================
-- Migration 006 — Post-audit security and performance hardening.
--
-- This migration is FULLY IDEMPOTENT. It can be re-run safely on databases
-- where 005 has already been applied; every block uses IF [NOT] EXISTS or
-- CREATE OR REPLACE so reruns are no-ops.
--
-- Background: the codebase audit identified several gaps that defense-in-depth
-- should close at the database layer:
--
--   1. (P0 / Critical) `task_assignments_member_self` allowed any member to
--      UPDATE their own assignment row with no column-level guard, meaning a
--      hostile member could PATCH `status='submitted'` directly via PostgREST
--      without ever uploading a file. Members no longer have direct write
--      access — submission flow goes through the server action which uses the
--      service-role client.
--
--   2. (P0 / High) `rules_select` exposed `prompt_template` (the AI rubric)
--      to plain members via `team_id = current_user_team()`. Lock rule SELECT
--      to managers + main_admin only.
--
--   3. (P1) Missing supporting indexes for the cron / submission detail
--      hot paths.
--
--   4. (Correctness) When a manager deletes a submission, the linked
--      `task_assignments` row keeps `status = 'submitted'/'late_submitted'`
--      with a now-NULL `submission_id`. A trigger flips it back to
--      'assigned' so the dashboard reflects reality.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Drop the over-permissive member-self UPDATE policy on task_assignments.
--    Members never need direct UPDATE access — the createSubmission Server
--    Action mirrors status/submission_id via the service-role client.
-- ---------------------------------------------------------------------------
drop policy if exists task_assignments_member_self on public.task_assignments;


-- ---------------------------------------------------------------------------
-- 2. Tighten validation_rules SELECT so members cannot read prompt_template.
--    Rule definitions are an internal grading rubric and must not leak.
-- ---------------------------------------------------------------------------
drop policy if exists rules_select on public.validation_rules;
create policy rules_select on public.validation_rules for select
  using (
    public.is_main_admin()
    or public.is_manager_of(team_id)
  );


-- ---------------------------------------------------------------------------
-- 3. Performance indexes flagged by the audit.
-- ---------------------------------------------------------------------------

-- "Latest runs for submission X" — covers the submission detail page query.
create index if not exists idx_validation_runs_submission_recent
  on public.validation_runs (submission_id, created_at desc);

-- Foreign-key index — speeds up cascade deletes and the manager dashboard
-- "tasks I own" query path.
create index if not exists idx_tasks_manager
  on public.tasks (manager_id);

-- Partial index for the nightly mark-missed cron that filters
-- `status = 'assigned'`. Keeps the index tiny and the scan index-only.
create index if not exists idx_task_assignments_active
  on public.task_assignments (created_at)
  where status = 'assigned';


-- ---------------------------------------------------------------------------
-- 4. Trigger: when a submission is deleted, revert any task_assignment that
--    still points at it back to 'assigned' so the assignee can resubmit and
--    the manager dashboard does not lie about completion.
-- ---------------------------------------------------------------------------
create or replace function public.reset_assignment_on_submission_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.task_assignments
     set status        = 'assigned',
         submission_id = null,
         submitted_at  = null,
         late_reason   = null
   where submission_id = old.id;
  return old;
end;
$$;

drop trigger if exists submissions_reset_assignment on public.submissions;
create trigger submissions_reset_assignment
  after delete on public.submissions
  for each row execute function public.reset_assignment_on_submission_delete();


-- ---------------------------------------------------------------------------
-- 5. Server-side aggregate for the department-stats screen.
--
-- Replaces the previous JS-side strategy of fetching every profile row and
-- counting client-side. Pushes the aggregation to Postgres, returns one row
-- per team with the manager (if any) joined and an exact `member_count`.
--
-- Marked SECURITY DEFINER so it can read profile counts even when invoked
-- by managers/main_admin who only have row-level visibility into their own
-- team. Authorisation gating happens in the calling Server Action; this RPC
-- intentionally returns aggregates without leaking row-level data.
-- ---------------------------------------------------------------------------
create or replace function public.list_departments_with_stats()
returns table (
  id uuid,
  name text,
  description text,
  manager_id uuid,
  settings jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  manager_full_name text,
  manager_email text,
  member_count bigint
)
language sql
security definer
stable
set search_path = public
as $$
  select
    t.id,
    t.name,
    t.description,
    t.manager_id,
    t.settings,
    t.created_at,
    t.updated_at,
    m.full_name,
    m.email,
    coalesce(c.member_count, 0)::bigint
  from public.teams t
  left join public.profiles m on m.id = t.manager_id
  left join lateral (
    select count(*)::bigint as member_count
    from public.profiles p
    where p.team_id = t.id
  ) c on true
  order by t.name asc;
$$;

-- Lock down execute: only authenticated callers, never anon.
revoke all on function public.list_departments_with_stats() from public;
grant execute on function public.list_departments_with_stats() to authenticated;
