-- ============================================================================
-- Security hardening migration (Security Audit findings M-21, M-22, H-5, H-8)
-- Apply via Supabase Studio → SQL Editor, or `psql $SUPABASE_DB_URL -f this-file.sql`
-- ============================================================================

-- ----------------------------------------------------------------------------
-- M-21: Tighten profiles_select policy.
-- The previous policy allowed ANY authenticated user to read ALL profiles,
-- enabling cross-tenant PII enumeration (email, full_name, team_id).
-- New policy: users can only read their own row, or rows on their team
-- (if they are a manager of that team), or all rows (if main_admin).
-- ----------------------------------------------------------------------------

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (
    auth.uid() = id
    or public.is_main_admin()
    or (
      public.current_user_role() = 'manager'
      and team_id = public.current_user_team()
    )
  );

-- ----------------------------------------------------------------------------
-- M-22: Re-add teams.manager_id = auth.uid() predicate to is_manager_of.
-- The function in 008_fix_manager_auth.sql dropped this check, meaning any
-- user whose profile.role = 'manager' AND profile.team_id = target_team
-- inherited manager rights — even if the teams.manager_id foreign key no
-- longer points at them (e.g. after a team reassignment).
-- The fix requires BOTH conditions simultaneously.
-- ----------------------------------------------------------------------------

create or replace function public.is_manager_of(target_team uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- main_admin always qualifies
    (select role from public.profiles where id = auth.uid()) = 'main_admin'
    or
    -- manager must BOTH own the profile team_id AND be the declared manager_id
    exists (
      select 1
      from public.profiles p
      join public.teams t on t.id = target_team
      where p.id = auth.uid()
        and p.role = 'manager'
        and p.team_id = target_team
        and t.manager_id = auth.uid()
    );
$$;

-- ----------------------------------------------------------------------------
-- H-5 / H-8: Force RLS for service-role on chat tables so that even the
-- service-role key cannot bypass row-level security on these sensitive tables.
-- Application code must add an explicit .eq("user_id", ...) filter OR be
-- covered by a policy that checks auth.uid().
-- ----------------------------------------------------------------------------

alter table public.chat_messages    force row level security;
alter table public.chat_threads     force row level security;

-- Ensure delete policy for chat_messages scopes to thread owner
drop policy if exists chat_messages_delete on public.chat_messages;
create policy chat_messages_delete on public.chat_messages for delete
  using (
    exists (
      select 1 from public.chat_threads t
      where t.id = chat_messages.thread_id
        and t.user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- M-8: Force RLS for service-role on submissions and task_assignments so
-- that in-code admin-client bypass is covered by DB-level enforcement.
-- ----------------------------------------------------------------------------

alter table public.submissions      force row level security;
alter table public.task_assignments force row level security;

-- ----------------------------------------------------------------------------
-- Notify PostgREST to reload its schema cache after policy changes
-- ----------------------------------------------------------------------------
notify pgrst, 'reload schema';
