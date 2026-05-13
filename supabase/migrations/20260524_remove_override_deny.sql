-- =============================================================================
-- Remove the "deny" override path from user_permission_overrides.
-- =============================================================================
-- After this migration, per-user overrides can only GRANT additional
-- capabilities. Role defaults are the single source of denial. The audit
-- history table keeps the 'set_deny' enum value so old rows remain readable.
--
-- Behavioural note: any user who relied on a 'deny' override to remove a
-- role-default capability will regain that capability after this runs.
-- =============================================================================

-- 1. Drop existing deny overrides (they no longer have a meaning).
DELETE FROM public.user_permission_overrides WHERE effect = 'deny';

-- 2. Replace the effect CHECK constraint to forbid 'deny' going forward.
--    The original constraint name from 20260509_granular_access_control.sql
--    is `user_permission_overrides_effect_check`. Drop defensively in case
--    the auto-generated name differs across environments, then re-add.
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.user_permission_overrides'::regclass
    AND contype  = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%effect%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.user_permission_overrides DROP CONSTRAINT %I',
      v_constraint_name
    );
  END IF;
END $$;

ALTER TABLE public.user_permission_overrides
  ADD CONSTRAINT user_permission_overrides_effect_check
  CHECK (effect = 'allow');

-- 3. Simplify has_capability: deny path is gone, so any non-expired override
--    row implies 'allow' (per the new CHECK), and we can fall straight back
--    to the role default otherwise.
CREATE OR REPLACE FUNCTION public.has_capability(
  p_user_id    uuid,
  p_capability text
) RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_role        text;
  v_has_allow   boolean;
  v_default     boolean;
BEGIN
  IF p_user_id IS NULL OR p_capability IS NULL THEN
    RETURN false;
  END IF;

  SELECT role::text INTO v_role FROM public.profiles WHERE id = p_user_id;
  IF v_role IS NULL THEN RETURN false; END IF;

  -- main_admin always has every capability
  IF v_role = 'main_admin' THEN RETURN true; END IF;

  -- Per-user override (allow only after this migration); skip expired rows.
  SELECT true INTO v_has_allow
  FROM public.user_permission_overrides
  WHERE user_id        = p_user_id
    AND capability_key = p_capability
    AND (expires_at IS NULL OR expires_at > now())
  LIMIT 1;

  IF v_has_allow THEN RETURN true; END IF;

  -- Fall back to role default
  SELECT true INTO v_default
  FROM public.role_permission_defaults
  WHERE role = v_role AND capability_key = p_capability;

  RETURN COALESCE(v_default, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.has_capability(uuid, text) TO authenticated, anon, service_role;

-- 4. Simplify effective_capabilities: drop the deny branch from the CASE/WHERE.
CREATE OR REPLACE FUNCTION public.effective_capabilities(p_user_id uuid)
RETURNS TABLE (capability_key text, source text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT role::text INTO v_role FROM public.profiles WHERE id = p_user_id;
  IF v_role IS NULL THEN
    RETURN;
  END IF;

  IF v_role = 'main_admin' THEN
    RETURN QUERY
      SELECT pd.key, 'main_admin'::text FROM public.permission_definitions pd;
    RETURN;
  END IF;

  RETURN QUERY
  WITH overrides AS (
    SELECT capability_key
    FROM public.user_permission_overrides
    WHERE user_id = p_user_id
      AND (expires_at IS NULL OR expires_at > now())
  ),
  defaults AS (
    SELECT capability_key
    FROM public.role_permission_defaults
    WHERE role = v_role
  )
  SELECT pd.key,
         CASE
           WHEN o.capability_key IS NOT NULL THEN 'override_allow'
           WHEN d.capability_key IS NOT NULL THEN 'role_default'
           ELSE NULL
         END AS source
  FROM public.permission_definitions pd
  LEFT JOIN overrides o ON o.capability_key = pd.key
  LEFT JOIN defaults  d ON d.capability_key = pd.key
  WHERE o.capability_key IS NOT NULL
     OR d.capability_key IS NOT NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.effective_capabilities(uuid) TO authenticated, anon, service_role;

-- 5. permission_override_history.action enum is intentionally NOT modified.
--    'set_deny' remains valid so historical audit entries still render in the
--    admin UI. New writes from the app will only ever insert 'set_allow' or
--    'cleared' after this migration.
