-- ============================================================================
-- Row Level Security: enable + role-aware policies for every table.
-- Defense in depth: server-side route guards re-check, but the database is the
-- ultimate authority.
-- ============================================================================

alter table public.profiles         enable row level security;
alter table public.teams            enable row level security;
alter table public.submissions      enable row level security;
alter table public.validation_rules enable row level security;
alter table public.validation_runs  enable row level security;
alter table public.announcements    enable row level security;
alter table public.materials        enable row level security;
alter table public.activity_log     enable row level security;
alter table public.report_snapshots enable row level security;

-- Helper: drop a policy if it exists, then recreate.
-- (Postgres does not support CREATE POLICY IF NOT EXISTS, so we drop+create.)

-- ----------------------------------------------------------------------------
-- profiles
-- ----------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (
    auth.uid() is not null
  );

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles for all
  using (public.is_main_admin())
  with check (public.is_main_admin());

drop policy if exists profiles_manager_insert on public.profiles;
create policy profiles_manager_insert on public.profiles for insert
  with check (
    public.current_user_role() = 'manager'
    and team_id = public.current_user_team()
    and role = 'member'
  );

-- ----------------------------------------------------------------------------
-- teams
-- ----------------------------------------------------------------------------
drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams for select
  using (
    public.is_main_admin()
    or manager_id = auth.uid()
    or id = public.current_user_team()
  );

drop policy if exists teams_admin_write on public.teams;
create policy teams_admin_write on public.teams for all
  using (public.is_main_admin())
  with check (public.is_main_admin());

drop policy if exists teams_manager_update on public.teams;
create policy teams_manager_update on public.teams for update
  using (manager_id = auth.uid())
  with check (manager_id = auth.uid());

-- ----------------------------------------------------------------------------
-- submissions
-- ----------------------------------------------------------------------------
drop policy if exists submissions_select on public.submissions;
create policy submissions_select on public.submissions for select
  using (
    public.is_main_admin()
    or uploader_id = auth.uid()
    or public.is_manager_of(team_id)
  );

drop policy if exists submissions_member_insert on public.submissions;
create policy submissions_member_insert on public.submissions for insert
  with check (
    uploader_id = auth.uid()
    and team_id = public.current_user_team()
  );

drop policy if exists submissions_manager_update on public.submissions;
create policy submissions_manager_update on public.submissions for update
  using (public.is_manager_of(team_id) or public.is_main_admin())
  with check (public.is_manager_of(team_id) or public.is_main_admin());

-- ----------------------------------------------------------------------------
-- validation_rules
-- ----------------------------------------------------------------------------
drop policy if exists rules_select on public.validation_rules;
create policy rules_select on public.validation_rules for select
  using (
    public.is_main_admin()
    or public.is_manager_of(team_id)
    or team_id = public.current_user_team()
    or team_id is null
  );

drop policy if exists rules_manager_write on public.validation_rules;
create policy rules_manager_write on public.validation_rules for all
  using (
    public.is_main_admin()
    or public.is_manager_of(team_id)
    or team_id = public.current_user_team()
    or (team_id is null and public.current_user_role() = 'manager')
  )
  with check (
    public.is_main_admin()
    or public.is_manager_of(team_id)
    or team_id = public.current_user_team()
    or (team_id is null and public.current_user_role() = 'manager')
  );

-- ----------------------------------------------------------------------------
-- validation_runs (read-only from clients; writes happen via service role)
-- ----------------------------------------------------------------------------
drop policy if exists runs_select on public.validation_runs;
create policy runs_select on public.validation_runs for select
  using (
    public.is_main_admin()
    or exists (
      select 1 from public.submissions s
      where s.id = validation_runs.submission_id
        and (s.uploader_id = auth.uid() or public.is_manager_of(s.team_id))
    )
  );

-- ----------------------------------------------------------------------------
-- announcements
-- ----------------------------------------------------------------------------
drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements for select
  using (
    public.is_main_admin()
    or team_id is null
    or team_id = public.current_user_team()
    or public.is_manager_of(team_id)
  );

drop policy if exists announcements_manager_write on public.announcements;
create policy announcements_manager_write on public.announcements for all
  using (
    public.is_main_admin()
    or (public.current_user_role() = 'manager' and (team_id is null or public.is_manager_of(team_id)))
  )
  with check (
    public.is_main_admin()
    or (public.current_user_role() = 'manager' and (team_id is null or public.is_manager_of(team_id)))
  );

-- ----------------------------------------------------------------------------
-- materials
-- ----------------------------------------------------------------------------
drop policy if exists materials_select on public.materials;
create policy materials_select on public.materials for select
  using (
    public.is_main_admin()
    or team_id is null
    or team_id = public.current_user_team()
    or public.is_manager_of(team_id)
  );

drop policy if exists materials_manager_write on public.materials;
create policy materials_manager_write on public.materials for all
  using (
    public.is_main_admin()
    or (public.current_user_role() = 'manager' and (team_id is null or public.is_manager_of(team_id)))
  )
  with check (
    public.is_main_admin()
    or (public.current_user_role() = 'manager' and (team_id is null or public.is_manager_of(team_id)))
  );

-- ----------------------------------------------------------------------------
-- activity_log (clients can READ scoped events; only service role writes)
-- ----------------------------------------------------------------------------
drop policy if exists activity_select on public.activity_log;
create policy activity_select on public.activity_log for select
  using (
    public.is_main_admin()
    or actor_id = auth.uid()
    or (team_id is not null and public.is_manager_of(team_id))
  );

-- ----------------------------------------------------------------------------
-- report_snapshots
-- ----------------------------------------------------------------------------
drop policy if exists snapshots_select on public.report_snapshots;
create policy snapshots_select on public.report_snapshots for select
  using (
    public.is_main_admin()
    or team_id is null
    or team_id = public.current_user_team()
    or public.is_manager_of(team_id)
  );
