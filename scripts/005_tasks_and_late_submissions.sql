-- ============================================================================
-- Migration 005 — Tasks, assignments, late submissions, and RLS hardening.
--
-- This script is fully idempotent and self-healing. If scripts 001/002/003
-- have not yet been run, the helper functions and updated_at trigger function
-- will be created here too so the policies below compile.
--
-- Run order if starting from a blank database:
--   001_init_schema.sql
--   002_helper_functions.sql
--   003_rls_policies.sql
--   004_seed_demo_data.sql        (optional)
--   005_tasks_and_late_submissions.sql   <-- this file
--
-- Postgres notes baked into this file:
--   * `ALTER TYPE ... ADD VALUE` cannot run inside a transaction or DO block,
--     so those statements are bare. `IF NOT EXISTS` makes them safe to re-run.
--   * Trigger function in script 002 is named `public.touch_updated_at()`.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. Pre-flight: make sure helper functions exist. If 002 was already run
--    these are no-ops; if it wasn't, the policies below will still compile.
-- ---------------------------------------------------------------------------
create or replace function public.current_user_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.current_user_team()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select team_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_manager_of(target_team uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.teams t
    where t.id = target_team
      and t.manager_id = auth.uid()
  )
  or (select role from public.profiles where id = auth.uid()) = 'main_admin';
$$;

create or replace function public.is_main_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()) = 'main_admin',
    false
  );
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;


-- ---------------------------------------------------------------------------
-- 1. New enum: task_assignment_status
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_assignment_status') then
    create type public.task_assignment_status as enum (
      'assigned',         -- assigned, not yet submitted, not yet due
      'submitted',        -- submitted on time
      'late_submitted',   -- submitted past due (with reason)
      'missed'            -- past due, never submitted
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Extend submission_status with late_submitted and missed.
--    These ALTERs MUST be top-level statements (Postgres forbids them inside
--    a transaction). Each is idempotent thanks to IF NOT EXISTS.
-- ---------------------------------------------------------------------------
alter type public.submission_status add value if not exists 'late_submitted';
alter type public.submission_status add value if not exists 'missed';


-- ---------------------------------------------------------------------------
-- 3. tasks and task_assignments tables
-- ---------------------------------------------------------------------------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  manager_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  instructions text,                          -- evaluated by LLM at submit time
  due_at timestamptz,
  allow_late boolean not null default true,   -- if false, late submissions rejected
  require_late_reason boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tasks_team on public.tasks (team_id, due_at desc);

create table if not exists public.task_assignments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  assignee_id uuid not null references public.profiles(id) on delete cascade,
  status public.task_assignment_status not null default 'assigned',
  submission_id uuid references public.submissions(id) on delete set null,
  late_reason text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, assignee_id)
);

create index if not exists idx_task_assignments_assignee
  on public.task_assignments (assignee_id, status, created_at desc);
create index if not exists idx_task_assignments_task
  on public.task_assignments (task_id);


-- ---------------------------------------------------------------------------
-- 4. submissions: task & late tracking columns
-- ---------------------------------------------------------------------------
alter table public.submissions
  add column if not exists task_id uuid references public.tasks(id) on delete set null,
  add column if not exists task_assignment_id uuid
    references public.task_assignments(id) on delete set null,
  add column if not exists late_reason text,
  add column if not exists submitted_at timestamptz default now(),
  add column if not exists is_late boolean not null default false;

create index if not exists idx_submissions_task on public.submissions (task_id);
create index if not exists idx_submissions_assignment
  on public.submissions (task_assignment_id);


-- ---------------------------------------------------------------------------
-- 5. updated_at triggers (uses public.touch_updated_at from script 002)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'tasks_set_updated_at') then
    create trigger tasks_set_updated_at
      before update on public.tasks
      for each row execute function public.touch_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'task_assignments_set_updated_at') then
    create trigger task_assignments_set_updated_at
      before update on public.task_assignments
      for each row execute function public.touch_updated_at();
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 6. Enable RLS + policies for tasks / task_assignments
-- ---------------------------------------------------------------------------
alter table public.tasks enable row level security;
alter table public.task_assignments enable row level security;

drop policy if exists tasks_select on public.tasks;
drop policy if exists tasks_manager_write on public.tasks;
drop policy if exists tasks_admin_write on public.tasks;

create policy tasks_select on public.tasks for select using (
  public.current_user_role() = 'main_admin'
  or (public.current_user_role() = 'manager' and public.is_manager_of(team_id))
  or (public.current_user_role() = 'member' and team_id = public.current_user_team())
);

create policy tasks_manager_write on public.tasks for all using (
  public.current_user_role() = 'main_admin'
  or (public.current_user_role() = 'manager' and public.is_manager_of(team_id))
) with check (
  public.current_user_role() = 'main_admin'
  or (public.current_user_role() = 'manager' and public.is_manager_of(team_id))
);

drop policy if exists task_assignments_select on public.task_assignments;
drop policy if exists task_assignments_member_self on public.task_assignments;
drop policy if exists task_assignments_manager_write on public.task_assignments;

-- Members see their own; managers see all in their team; admins see all.
create policy task_assignments_select on public.task_assignments for select using (
  public.current_user_role() = 'main_admin'
  or assignee_id = (select auth.uid())
  or (
    public.current_user_role() = 'manager'
    and exists (
      select 1 from public.tasks t
      where t.id = task_id and public.is_manager_of(t.team_id)
    )
  )
);

-- Members can update only their own assignment (when they submit, the action
-- writes status + submission_id + reason). Managers/admins can write any.
create policy task_assignments_member_self on public.task_assignments for update using (
  assignee_id = (select auth.uid())
) with check (
  assignee_id = (select auth.uid())
);

create policy task_assignments_manager_write on public.task_assignments for all using (
  public.current_user_role() = 'main_admin'
  or (
    public.current_user_role() = 'manager'
    and exists (select 1 from public.tasks t where t.id = task_id and public.is_manager_of(t.team_id))
  )
) with check (
  public.current_user_role() = 'main_admin'
  or (
    public.current_user_role() = 'manager'
    and exists (select 1 from public.tasks t where t.id = task_id and public.is_manager_of(t.team_id))
  )
);


-- ---------------------------------------------------------------------------
-- 7. RLS hardening: tighten manager write on announcements + materials so
--    managers cannot post global (team_id IS NULL) rows. Add explicit deny
--    policies for service-role-only tables to make intent unambiguous.
-- ---------------------------------------------------------------------------
drop policy if exists announcements_manager_write on public.announcements;
create policy announcements_manager_write on public.announcements for all using (
  public.current_user_role() = 'main_admin'
  or (
    public.current_user_role() = 'manager'
    and team_id is not null
    and public.is_manager_of(team_id)
  )
) with check (
  public.current_user_role() = 'main_admin'
  or (
    public.current_user_role() = 'manager'
    and team_id is not null
    and public.is_manager_of(team_id)
  )
);

drop policy if exists materials_manager_write on public.materials;
create policy materials_manager_write on public.materials for all using (
  public.current_user_role() = 'main_admin'
  or (
    public.current_user_role() = 'manager'
    and team_id is not null
    and public.is_manager_of(team_id)
  )
) with check (
  public.current_user_role() = 'main_admin'
  or (
    public.current_user_role() = 'manager'
    and team_id is not null
    and public.is_manager_of(team_id)
  )
);

-- Explicit deny for system-only writes (service role bypasses RLS).
drop policy if exists activity_log_no_client_write on public.activity_log;
create policy activity_log_no_client_write on public.activity_log for insert
  with check (false);

drop policy if exists validation_runs_no_client_write on public.validation_runs;
create policy validation_runs_no_client_write on public.validation_runs for all
  using (false) with check (false);

drop policy if exists report_snapshots_no_client_write on public.report_snapshots;
create policy report_snapshots_no_client_write on public.report_snapshots for all
  using (false) with check (false);


-- ---------------------------------------------------------------------------
-- 8. Helper: bulk-create assignments for a task targeting a team.
-- ---------------------------------------------------------------------------
create or replace function public.assign_task_to_team(
  p_task_id uuid,
  p_team_id uuid
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer;
begin
  -- Only managers of the team or main_admin can call this. The Server Action
  -- already checks; this is defense in depth.
  if not (
    public.current_user_role() = 'main_admin'
    or (public.current_user_role() = 'manager' and public.is_manager_of(p_team_id))
  ) then
    raise exception 'not authorised';
  end if;

  insert into public.task_assignments (task_id, assignee_id)
  select p_task_id, p.id
  from public.profiles p
  where p.team_id = p_team_id and p.role = 'member'
  on conflict (task_id, assignee_id) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

revoke all on function public.assign_task_to_team(uuid, uuid) from public;
grant execute on function public.assign_task_to_team(uuid, uuid) to authenticated;
