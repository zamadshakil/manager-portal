-- =============================================================================
-- Capability-aware RLS write (and select) policies
-- =============================================================================
-- Problem: all existing write policies only check role (main_admin / manager).
-- Members granted capabilities via user_permission_overrides are blocked at
-- the DB level even after the app-level assertCapability check passes.
--
-- Fix: extend write policies to also allow users whose effective capability set
-- (per has_capability / has_scoped_capability) includes the relevant action,
-- provided the resource belongs to their own team.
--
-- The read-side policies for tasks and submissions are similarly extended so
-- capability-granted members can see the rows they need to act on.
--
-- App-layer assertCapability checks remain in place as defence-in-depth.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. announcements
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS announcements_manager_write ON public.announcements;
DROP POLICY IF EXISTS announcements_write         ON public.announcements;

CREATE POLICY announcements_write ON public.announcements
FOR ALL
USING (
  -- main_admin: full control
  public.current_user_role() = 'main_admin'
  -- manager: their own team's announcements only (global blocked per original hardening)
  OR (
    public.current_user_role() = 'manager'
    AND team_id IS NOT NULL
    AND public.is_manager_of(team_id)
  )
  -- capability-granted users: own-team rows only
  OR (
    team_id IS NOT NULL
    AND team_id = public.current_user_team()
    AND (
      public.has_capability(auth.uid(), 'announcements.create')
      OR public.has_capability(auth.uid(), 'announcements.delete')
    )
  )
)
WITH CHECK (
  public.current_user_role() = 'main_admin'
  OR (
    public.current_user_role() = 'manager'
    AND team_id IS NOT NULL
    AND public.is_manager_of(team_id)
  )
  -- Only create capability allows inserting new rows
  OR (
    team_id IS NOT NULL
    AND team_id = public.current_user_team()
    AND public.has_capability(auth.uid(), 'announcements.create')
  )
);


-- ---------------------------------------------------------------------------
-- 2. materials
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS materials_manager_write ON public.materials;
DROP POLICY IF EXISTS materials_write         ON public.materials;

CREATE POLICY materials_write ON public.materials
FOR ALL
USING (
  public.current_user_role() = 'main_admin'
  OR (
    public.current_user_role() = 'manager'
    AND team_id IS NOT NULL
    AND public.is_manager_of(team_id)
  )
  OR (
    team_id IS NOT NULL
    AND team_id = public.current_user_team()
    AND (
      public.has_capability(auth.uid(), 'materials.create')
      OR public.has_capability(auth.uid(), 'materials.delete')
    )
  )
)
WITH CHECK (
  public.current_user_role() = 'main_admin'
  OR (
    public.current_user_role() = 'manager'
    AND team_id IS NOT NULL
    AND public.is_manager_of(team_id)
  )
  OR (
    team_id IS NOT NULL
    AND team_id = public.current_user_team()
    AND public.has_capability(auth.uid(), 'materials.create')
  )
);


-- ---------------------------------------------------------------------------
-- 3. tasks — select (capability-granted members see their team's tasks)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS tasks_select ON public.tasks;

CREATE POLICY tasks_select ON public.tasks FOR SELECT USING (
  public.current_user_role() = 'main_admin'
  OR (public.current_user_role() = 'manager' AND public.is_manager_of(team_id))
  -- plain members: only tasks they are assigned to
  OR (
    public.current_user_role() = 'member'
    AND EXISTS (
      SELECT 1
      FROM public.task_assignments ta
      WHERE ta.task_id = id
        AND ta.assignee_id = (SELECT auth.uid())
    )
  )
  -- capability-granted members: all tasks in their own team
  OR (
    public.current_user_team() IS NOT NULL
    AND team_id = public.current_user_team()
    AND (
      public.has_capability(auth.uid(), 'tasks.create')
      OR public.has_capability(auth.uid(), 'tasks.assign')
      OR public.has_capability(auth.uid(), 'tasks.delete')
      OR public.has_capability(auth.uid(), 'tasks.update')
    )
  )
);


-- ---------------------------------------------------------------------------
-- 4. tasks — write
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS tasks_manager_write ON public.tasks;
DROP POLICY IF EXISTS tasks_write         ON public.tasks;

CREATE POLICY tasks_write ON public.tasks
FOR ALL
USING (
  public.current_user_role() = 'main_admin'
  OR (public.current_user_role() = 'manager' AND public.is_manager_of(team_id))
  OR (
    team_id IS NOT NULL
    AND team_id = public.current_user_team()
    AND (
      public.has_capability(auth.uid(), 'tasks.create')
      OR public.has_capability(auth.uid(), 'tasks.delete')
    )
  )
)
WITH CHECK (
  public.current_user_role() = 'main_admin'
  OR (public.current_user_role() = 'manager' AND public.is_manager_of(team_id))
  OR (
    team_id IS NOT NULL
    AND team_id = public.current_user_team()
    AND public.has_capability(auth.uid(), 'tasks.create')
  )
);


-- ---------------------------------------------------------------------------
-- 5. submissions — select (capability-granted members see team submissions)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS submissions_select ON public.submissions;

CREATE POLICY submissions_select ON public.submissions FOR SELECT USING (
  public.is_main_admin()
  OR uploader_id = auth.uid()
  OR public.is_manager_of(team_id)
  -- capability-granted members: all submissions in their own team
  OR (
    team_id = public.current_user_team()
    AND (
      public.has_capability(auth.uid(), 'submissions.update')
      OR public.has_capability(auth.uid(), 'submissions.delete')
    )
  )
);


-- ---------------------------------------------------------------------------
-- 6. submissions — update
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS submissions_manager_update ON public.submissions;
DROP POLICY IF EXISTS submissions_update         ON public.submissions;

CREATE POLICY submissions_update ON public.submissions FOR UPDATE
USING (
  public.is_main_admin()
  OR public.is_manager_of(team_id)
  OR (
    team_id = public.current_user_team()
    AND public.has_capability(auth.uid(), 'submissions.update')
  )
)
WITH CHECK (
  public.is_main_admin()
  OR public.is_manager_of(team_id)
  OR (
    team_id = public.current_user_team()
    AND public.has_capability(auth.uid(), 'submissions.update')
  )
);


-- ---------------------------------------------------------------------------
-- 7. submissions — delete (new policy; no delete policy existed before)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS submissions_delete ON public.submissions;

CREATE POLICY submissions_delete ON public.submissions FOR DELETE
USING (
  public.is_main_admin()
  OR public.is_manager_of(team_id)
  OR (
    team_id = public.current_user_team()
    AND public.has_capability(auth.uid(), 'submissions.delete')
  )
);


-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
