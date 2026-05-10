-- =============================================================================
-- Add expires_at to user_permission_overrides
-- =============================================================================
-- Adds an optional expiry timestamp so overrides can be time-bounded.
-- Updates has_capability to ignore expired rows.
-- Adds a permission_override_history table for audit trail.
-- =============================================================================

-- 1. Add expires_at / granted_by columns (nullable = no expiry / no granter)
ALTER TABLE public.user_permission_overrides
  ADD COLUMN IF NOT EXISTS expires_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS granted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT NULL;

-- 2. Index for fast expiry-aware lookups
CREATE INDEX IF NOT EXISTS idx_upo_user_capability
  ON public.user_permission_overrides (user_id, capability_key);

CREATE INDEX IF NOT EXISTS idx_upo_expires_at
  ON public.user_permission_overrides (expires_at)
  WHERE expires_at IS NOT NULL;

-- 3. Update has_capability to skip expired overrides
--    Uses correct column names: capability_key (text) and effect ('allow'|'deny')
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
  v_role    text;
  v_effect  text;
  v_default boolean;
BEGIN
  IF p_user_id IS NULL OR p_capability IS NULL THEN
    RETURN false;
  END IF;

  SELECT role::text INTO v_role FROM public.profiles WHERE id = p_user_id;
  IF v_role IS NULL THEN RETURN false; END IF;

  -- main_admin always has every capability
  IF v_role = 'main_admin' THEN RETURN true; END IF;

  -- Per-user override; deny wins, allow grants; skip expired rows
  SELECT effect INTO v_effect
  FROM public.user_permission_overrides
  WHERE user_id        = p_user_id
    AND capability_key = p_capability
    AND (expires_at IS NULL OR expires_at > now());

  IF v_effect = 'deny'  THEN RETURN false; END IF;
  IF v_effect = 'allow' THEN RETURN true;  END IF;

  -- Fall back to role default
  SELECT true INTO v_default
  FROM public.role_permission_defaults
  WHERE role = v_role AND capability_key = p_capability;

  RETURN COALESCE(v_default, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.has_capability(uuid, text) TO authenticated, anon, service_role;

-- 4. Permission override history table
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

CREATE INDEX IF NOT EXISTS idx_poh_user_id
  ON public.permission_override_history (user_id, changed_at DESC);

-- 5. RLS for history table
ALTER TABLE public.permission_override_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "poh_select_admin" ON public.permission_override_history
  FOR SELECT USING (
    public.has_capability(auth.uid(), 'user_management.permissions')
  );

CREATE POLICY "poh_insert_admin" ON public.permission_override_history
  FOR INSERT WITH CHECK (
    public.has_capability(auth.uid(), 'user_management.permissions')
  );
