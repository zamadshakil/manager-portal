-- ============================================================================
-- submissions.attempts — pipeline retry counter
-- ============================================================================
--
-- Tracks how many times the AI validation pipeline has been invoked for a
-- submission. Used by:
--   - the cron auto-retry safety net (only retries `queued` rows up to N attempts)
--   - manual retries (admin "Re-run validation" also increments)
--
-- Bounded retries prevent runaway AI-credit consumption when a row genuinely
-- can't be processed (e.g. permanently malformed file). After N attempts the
-- cron marks the row failed with a clear message.
--
-- Existing rows get 0 (effectively "never run"); the pipeline increments to
-- 1 on first execution, so this is backward-compatible.

alter table public.submissions
  add column if not exists attempts integer not null default 0;

-- Composite index helps the cron sweep (`status in (...) and updated_at < ...`).
-- Existing single-column indexes on status / updated_at may exist; this one is
-- narrowly tailored to the cron query plan.
create index if not exists submissions_status_updated_at_idx
  on public.submissions (status, updated_at);

-- ----------------------------------------------------------------------------
-- Atomic increment helper. Race-safe under concurrent pipeline invocations
-- (server-side after() + client POST + cron retry can all collide on the
-- same row). A read-modify-write from the application layer would race;
-- pushing it into Postgres makes the increment atomic.
-- ----------------------------------------------------------------------------
create or replace function public.increment_submission_attempts(p_submission_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new integer;
begin
  update public.submissions
     set attempts = attempts + 1
   where id = p_submission_id
   returning attempts into v_new;
  return v_new;
end;
$$;

revoke all on function public.increment_submission_attempts(uuid) from public;
grant execute on function public.increment_submission_attempts(uuid) to service_role;

notify pgrst, 'reload schema';
