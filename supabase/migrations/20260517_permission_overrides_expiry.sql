-- =============================================================================
-- Add expires_at to user_permission_overrides
-- =============================================================================
-- Adds an optional expiry timestamp so overrides can be time-bounded.
-- Also updates has_capability / has_scoped_capability to ignore expired rows,
-- and adds a permission_override_history table for audit trail.
-- =============================================================================

-- 1. Add expires_at column (nullable = no expiry)
ALTER TABLE public.user_permission_overrides
  ADD COLUMN IF NOT EXISTS expires_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS granted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT NULL;

-- 2. Index for fast expiry-aware lookups
CREATE INDEX IF NOT EXISTS idx_upo_user_capability
  ON public.user_permission_overrides (user_id, capability);

CREATE INDEX IF NOT EXISTS idx_upo_expires_at
  ON public.user_permission_overrides (expires_at)
  WHERE expires_at IS NOT NULL;

-- 3. Update has_capability to ignore expired overrides
CREATE OR REPLACE FUNCTION public.has_capability(
  p_user_id  uuid,
  p_cap      text
) RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_role      text;
  v_override  record;
  v_default   boolean;
BEGIN
  -- main_admin always has every capability
  SELECT role INTO v_role FROM public.profiles WHERE id = p_user_id;
  IF v_role = 'main_admin' THEN
    RETURN true;
  END IF;

  -- Check user-level overrides (deny before allow), skip expired
  FOR v_override IN
    SELECT allow
    FROM public.user_permission_overrides
    WHERE user_id   = p_user_id
      AND capability = p_cap
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY allow   -- false (deny) first
  LOOP
    RETURN v_override.allow;
  END LOOP;

  -- Fall back to role default
  SELECT allowed INTO v_default
  FROM public.role_permission_defaults
  WHERE role = v_role
    AND capability = p_cap;

  RETURN COALESCE(v_default, false);
END;
$$;

-- 4. Update has_scoped_capability similarly
CREATE OR REPLACE FUNCTION public.has_scoped_capability(
  p_user_id   uuid,
  p_cap       text,
  p_owner_id  uuid  DEFAULT NULL,
  p_team_id   uuid  DEFAULT NULL,
  p_is_global boolean DEFAULT false
) RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_role      text;
  v_team      uuid;
  v_override  record;
  v_default   boolean;
BEGIN
  -- main_admin always allowed
  SELECT role, team_id INTO v_role, v_team
  FROM public.profiles WHERE id = p_user_id;

  IF v_role = 'main_admin' THEN
    RETURN true;
  END IF;

  -- Owner of the resource always has access
  IF p_owner_id IS NOT NULL AND p_owner_id = p_user_id THEN
    RETURN true;
  END IF;

  -- Global resources: check capability without scope restriction
  IF p_is_global THEN
    RETURN public.has_capability(p_user_id, p_cap);
  END IF;

  -- Team-scoped: manager must belong to the same team
  IF p_team_id IS NOT NULL AND v_role = 'manager' AND v_team != p_team_id THEN
    RETURN false;
  END IF;

  -- Check user-level overrides (deny before allow), skip expired
  FOR v_override IN
    SELECT allow
    FROM public.user_permission_overrides
    WHERE user_id   = p_user_id
      AND capability = p_cap
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY allow
  LOOP
    RETURN v_override.allow;
  END LOOP;

  -- Role default
  SELECT allowed INTO v_default
  FROM public.role_permission_defaults
  WHERE role = v_role
    AND capability = p_cap;

  RETURN COALESCE(v_default, false);
END;
$$;

-- 5. Permission override history table
CREATE TABLE IF NOT EXISTS public.permission_override_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  capability    text NOT NULL,
  action        text NOT NULL CHECK (action IN ('set_allow', 'set_deny', 'cleared')),
  allow         boolean,
  expires_at    timestamptz,
  granted_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  changed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_poh_user_id ON public.permission_override_history (user_id, changed_at DESC);

-- 6. RLS for history table
ALTER TABLE public.permission_override_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "poh_select_admin" ON public.permission_override_history
  FOR SELECT USING (
    public.has_capability(auth.uid(), 'user_management.permissions')
  );

CREATE POLICY "poh_insert_admin" ON public.permission_override_history
  FOR INSERT WITH CHECK (
    public.has_capability(auth.uid(), 'user_management.permissions')
  );
