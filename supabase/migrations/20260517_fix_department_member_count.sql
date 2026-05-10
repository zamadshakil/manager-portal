-- Fix: list_departments_with_stats was counting soft-deleted profiles.
-- Add deleted_at IS NULL filter so the card count matches the detail view.

create or replace function public.list_departments_with_stats()
returns table (
  id                uuid,
  name              text,
  description       text,
  manager_id        uuid,
  created_at        timestamptz,
  updated_at        timestamptz,
  manager_full_name text,
  manager_email     text,
  member_count      int
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
      and deleted_at is null
    group by team_id
  ) mc on mc.team_id = t.id
  where public.is_main_admin()
     or t.id = public.current_user_team()
     or t.manager_id = auth.uid()
  order by t.name asc;
$$;

revoke all on function public.list_departments_with_stats() from public;
grant execute on function public.list_departments_with_stats() to authenticated;
