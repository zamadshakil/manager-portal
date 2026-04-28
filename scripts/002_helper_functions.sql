-- ============================================================================
-- Helper functions used by RLS policies and the application.
-- ============================================================================

-- Returns the role of the current authenticated user, or null.
create or replace function public.current_user_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Returns the team_id of the current authenticated user.
create or replace function public.current_user_team()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select team_id from public.profiles where id = auth.uid();
$$;

-- True if the current user manages the given team.
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

-- True if the current user is a main admin.
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

-- ----------------------------------------------------------------------------
-- updated_at triggers
-- ----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists touch_profiles    on public.profiles;
drop trigger if exists touch_teams       on public.teams;
drop trigger if exists touch_submissions on public.submissions;
drop trigger if exists touch_rules       on public.validation_rules;

create trigger touch_profiles    before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger touch_teams       before update on public.teams
  for each row execute function public.touch_updated_at();
create trigger touch_submissions before update on public.submissions
  for each row execute function public.touch_updated_at();
create trigger touch_rules       before update on public.validation_rules
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- Auto-create a profile row when a new auth user is created.
-- The first user ever created becomes main_admin automatically.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_first boolean;
  initial_role user_role;
begin
  select count(*) = 0 into is_first from public.profiles;

  initial_role := coalesce(
    (new.raw_user_meta_data ->> 'role')::user_role,
    case when is_first then 'main_admin'::user_role else 'member'::user_role end
  );

  insert into public.profiles (id, email, full_name, role, team_id, manager_id, must_reset)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    initial_role,
    nullif(new.raw_user_meta_data ->> 'team_id', '')::uuid,
    nullif(new.raw_user_meta_data ->> 'manager_id', '')::uuid,
    coalesce((new.raw_user_meta_data ->> 'must_reset')::boolean, false)
  )
  on conflict (id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
