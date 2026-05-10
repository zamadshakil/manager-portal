-- ============================================================================
-- Fix assign_task_to_team to exclude soft-deleted members (deleted_at IS NOT NULL)
-- ============================================================================

create or replace function public.assign_task_to_team(p_task_id uuid, p_team_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  -- Validate task belongs to the team
  if not exists (select 1 from public.tasks where id = p_task_id and team_id = p_team_id) then
    raise exception 'Task does not exist or does not belong to team %', p_team_id;
  end if;

  with new_assigns as (
    insert into public.task_assignments (task_id, assignee_id)
    select p_task_id, id
    from public.profiles
    where team_id = p_team_id
      and deleted_at is null
      and id not in (
        select assignee_id from public.task_assignments where task_id = p_task_id
      )
    returning id
  )
  select count(*) into inserted_count from new_assigns;

  return inserted_count;
end;
$$;
