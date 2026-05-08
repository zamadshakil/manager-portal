-- =============================================================================
-- Granular Access Control — Foundation
-- =============================================================================
-- Implements:
--   • permission_definitions      — canonical capability catalog
--   • role_permission_defaults    — baseline grants per role
--   • user_permission_overrides   — explicit allow/deny per user (admin-managed)
--   • has_capability()            — resolver used by RLS, RPCs, and the app
--   • has_scoped_capability()     — capability + (team / owner / global) scope
--   • Seeds the initial catalog and the role defaults
--
-- Decision rule (in order):
--   1. main_admin → always allow (single source of truth).
--   2. user_permission_overrides 'deny' → false.
--   3. user_permission_overrides 'allow' → true.
--   4. role_permission_defaults match → true.
--   5. otherwise → false.
--
-- All app-layer checks must call has_capability() / has_scoped_capability().
-- All RLS policies that gate granular features must do the same so the DB
-- and the app reach the same decision.
-- =============================================================================

-- 1. permission_definitions ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.permission_definitions (
    key             text PRIMARY KEY,
    module          text NOT NULL,
    action          text NOT NULL,
    description     text NOT NULL DEFAULT '',
    is_admin_only   boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS permission_definitions_module_idx
    ON public.permission_definitions (module);

ALTER TABLE public.permission_definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS permission_definitions_read_all ON public.permission_definitions;
CREATE POLICY permission_definitions_read_all
    ON public.permission_definitions
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- Only main_admin can mutate the catalog (typically only via migrations).
DROP POLICY IF EXISTS permission_definitions_admin_write ON public.permission_definitions;
CREATE POLICY permission_definitions_admin_write
    ON public.permission_definitions
    FOR ALL
    USING (EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'main_admin'
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'main_admin'
    ));


-- 2. role_permission_defaults -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.role_permission_defaults (
    role            text NOT NULL,
    capability_key  text NOT NULL REFERENCES public.permission_definitions(key) ON DELETE CASCADE,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (role, capability_key)
);

CREATE INDEX IF NOT EXISTS role_permission_defaults_role_idx
    ON public.role_permission_defaults (role);

ALTER TABLE public.role_permission_defaults ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS role_permission_defaults_read_all ON public.role_permission_defaults;
CREATE POLICY role_permission_defaults_read_all
    ON public.role_permission_defaults
    FOR SELECT
    USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS role_permission_defaults_admin_write ON public.role_permission_defaults;
CREATE POLICY role_permission_defaults_admin_write
    ON public.role_permission_defaults
    FOR ALL
    USING (EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'main_admin'
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'main_admin'
    ));


-- 3. user_permission_overrides ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_permission_overrides (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    capability_key  text NOT NULL REFERENCES public.permission_definitions(key) ON DELETE CASCADE,
    effect          text NOT NULL CHECK (effect IN ('allow', 'deny')),
    granted_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    reason          text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, capability_key)
);

CREATE INDEX IF NOT EXISTS user_permission_overrides_user_idx
    ON public.user_permission_overrides (user_id);

CREATE OR REPLACE FUNCTION public.user_permission_overrides_touch()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_permission_overrides_touch_trg ON public.user_permission_overrides;
CREATE TRIGGER user_permission_overrides_touch_trg
    BEFORE UPDATE ON public.user_permission_overrides
    FOR EACH ROW EXECUTE FUNCTION public.user_permission_overrides_touch();

ALTER TABLE public.user_permission_overrides ENABLE ROW LEVEL SECURITY;

-- Users can read their own overrides (so the app can show "you have X").
DROP POLICY IF EXISTS user_permission_overrides_read_self ON public.user_permission_overrides;
CREATE POLICY user_permission_overrides_read_self
    ON public.user_permission_overrides
    FOR SELECT
    USING (user_id = auth.uid());

-- Main admin reads + writes all overrides.
DROP POLICY IF EXISTS user_permission_overrides_admin_all ON public.user_permission_overrides;
CREATE POLICY user_permission_overrides_admin_all
    ON public.user_permission_overrides
    FOR ALL
    USING (EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'main_admin'
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'main_admin'
    ));


-- 4. Resolver functions -------------------------------------------------------
-- Returns true iff the user has the requested capability under the agreed
-- decision rule. SECURITY DEFINER so it can be called from RLS without
-- recursive permission checks on the underlying tables.
CREATE OR REPLACE FUNCTION public.has_capability(
    p_user_id uuid,
    p_capability text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role     text;
    v_effect   text;
    v_default  boolean;
BEGIN
    IF p_user_id IS NULL OR p_capability IS NULL THEN
        RETURN false;
    END IF;

    SELECT role::text INTO v_role
    FROM public.profiles
    WHERE id = p_user_id;

    IF v_role IS NULL THEN
        RETURN false;
    END IF;

    -- 1. main_admin bypass (single source of truth).
    IF v_role = 'main_admin' THEN
        RETURN true;
    END IF;

    -- 2/3. Per-user override (deny wins, allow grants).
    SELECT effect INTO v_effect
    FROM public.user_permission_overrides
    WHERE user_id = p_user_id AND capability_key = p_capability;

    IF v_effect = 'deny' THEN
        RETURN false;
    ELSIF v_effect = 'allow' THEN
        RETURN true;
    END IF;

    -- 4. Role default.
    SELECT true INTO v_default
    FROM public.role_permission_defaults
    WHERE role = v_role AND capability_key = p_capability;

    RETURN COALESCE(v_default, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.has_capability(uuid, text) TO authenticated, anon, service_role;


-- Combines a capability check with resource scope. Encodes the same scope
-- rules the app uses today: main_admin sees all, owner always sees own,
-- otherwise team-scoped or global-only.
CREATE OR REPLACE FUNCTION public.has_scoped_capability(
    p_user_id   uuid,
    p_capability text,
    p_team_id   uuid DEFAULT NULL,
    p_owner_id  uuid DEFAULT NULL,
    p_is_global boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role     text;
    v_team_id  uuid;
    v_has_cap  boolean;
BEGIN
    IF NOT public.has_capability(p_user_id, p_capability) THEN
        RETURN false;
    END IF;

    SELECT role::text, team_id INTO v_role, v_team_id
    FROM public.profiles
    WHERE id = p_user_id;

    IF v_role = 'main_admin' THEN
        RETURN true;
    END IF;

    -- Owner of the resource always passes scope.
    IF p_owner_id IS NOT NULL AND p_owner_id = p_user_id THEN
        RETURN true;
    END IF;

    -- Global resources visible to anyone with the capability.
    IF COALESCE(p_is_global, false) THEN
        RETURN true;
    END IF;

    -- Otherwise resource must belong to the user's team.
    IF p_team_id IS NULL THEN
        -- Untargeted check (no resource scope provided): capability alone is enough.
        RETURN true;
    END IF;

    RETURN v_team_id IS NOT NULL AND v_team_id = p_team_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.has_scoped_capability(uuid, text, uuid, uuid, boolean) TO authenticated, anon, service_role;


-- Convenience: list every capability key currently effective for a user.
-- Used by the admin UI and the in-app permission resolver cache.
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
    SELECT role::text INTO v_role FROM public.profiles WHERE id = p_user_id;
    IF v_role IS NULL THEN
        RETURN;
    END IF;

    IF v_role = 'main_admin' THEN
        RETURN QUERY
            SELECT pd.key, 'admin'::text
            FROM public.permission_definitions pd;
        RETURN;
    END IF;

    RETURN QUERY
    WITH overrides AS (
        SELECT capability_key, effect
        FROM public.user_permission_overrides
        WHERE user_id = p_user_id
    ),
    defaults AS (
        SELECT capability_key
        FROM public.role_permission_defaults
        WHERE role = v_role
    )
    SELECT pd.key,
           CASE
             WHEN o.effect = 'allow' THEN 'override_allow'
             WHEN d.capability_key IS NOT NULL THEN 'role_default'
             ELSE NULL
           END AS source
    FROM public.permission_definitions pd
    LEFT JOIN overrides o ON o.capability_key = pd.key
    LEFT JOIN defaults d  ON d.capability_key = pd.key
    WHERE
      -- explicit allow grants regardless of role defaults
      o.effect = 'allow'
      OR (
        d.capability_key IS NOT NULL
        AND (o.effect IS NULL OR o.effect <> 'deny')
      );
END;
$$;

GRANT EXECUTE ON FUNCTION public.effective_capabilities(uuid) TO authenticated, anon, service_role;


-- 5. Seed catalog -------------------------------------------------------------
INSERT INTO public.permission_definitions (key, module, action, description, is_admin_only) VALUES
    -- tasks
    ('tasks.read',                  'tasks',             'read',          'Read tasks within scope', false),
    ('tasks.create',                'tasks',             'create',        'Create tasks', false),
    ('tasks.update',                'tasks',             'update',        'Update tasks', false),
    ('tasks.delete',                'tasks',             'delete',        'Delete tasks', false),
    ('tasks.assign',                'tasks',             'assign',        'Assign tasks to team members', false),
    ('tasks.ai_analyze',            'tasks',             'ai_analyze',    'Allow Smart AI to analyze tasks', false),

    -- materials
    ('materials.read',              'materials',         'read',          'Read materials within scope', false),
    ('materials.create',            'materials',         'create',        'Create materials', false),
    ('materials.update',            'materials',         'update',        'Update materials', false),
    ('materials.delete',            'materials',         'delete',        'Delete materials', false),
    ('materials.ai_analyze',        'materials',         'ai_analyze',    'Allow Smart AI to analyze materials', false),

    -- validation rules (the user''s flagship example)
    ('validation_rules.read',       'validation_rules',  'read',          'Read validation rules', false),
    ('validation_rules.create',     'validation_rules',  'create',        'Create validation rules', false),
    ('validation_rules.update',     'validation_rules',  'update',        'Update validation rules', false),
    ('validation_rules.delete',     'validation_rules',  'delete',        'Delete validation rules', false),
    ('validation_rules.ai_analyze', 'validation_rules',  'ai_analyze',    'Allow Smart AI to analyze validation rules', false),

    -- submissions
    ('submissions.read',            'submissions',       'read',          'Read submissions within scope', false),
    ('submissions.create',          'submissions',       'create',        'Submit work for tasks', false),
    ('submissions.update',          'submissions',       'update',        'Update submission status / metadata', false),
    ('submissions.delete',          'submissions',       'delete',        'Delete submissions', false),
    ('submissions.ai_analyze',      'submissions',       'ai_analyze',    'Allow Smart AI to analyze submissions', false),

    -- announcements
    ('announcements.read',          'announcements',     'read',          'Read announcements', false),
    ('announcements.create',        'announcements',     'create',        'Create announcements', false),
    ('announcements.update',        'announcements',     'update',        'Update announcements', false),
    ('announcements.delete',        'announcements',     'delete',        'Delete announcements', false),
    ('announcements.ai_analyze',    'announcements',     'ai_analyze',    'Allow Smart AI to analyze announcements', false),

    -- ai credits
    ('ai_credits.read_self',        'ai_credits',        'read_self',     'View your own AI credit balance / history', false),
    ('ai_credits.read_all',         'ai_credits',        'read_all',      'View other users'' AI credit balance / history', true),
    ('ai_credits.manage',           'ai_credits',        'manage',        'Adjust AI credit limits for users', true),

    -- smart ai
    ('smart_ai.chat',               'smart_ai',          'chat',          'Use Smart AI chat', false),
    ('smart_ai.analytics_self',     'smart_ai',          'analytics_self','View own Smart AI analytics', false),
    ('smart_ai.analytics_all',      'smart_ai',          'analytics_all', 'View global Smart AI analytics', true),

    -- team / user management
    ('team_management.read',        'team_management',   'read',          'View teams', false),
    ('team_management.write',       'team_management',   'write',         'Create / edit / delete teams', true),
    ('user_management.read',        'user_management',   'read',          'View users', false),
    ('user_management.write',       'user_management',   'write',         'Provision / edit / disable users', true),
    ('user_management.permissions', 'user_management',   'permissions',   'Grant / revoke per-user capability overrides', true)
ON CONFLICT (key) DO UPDATE SET
    module = EXCLUDED.module,
    action = EXCLUDED.action,
    description = EXCLUDED.description,
    is_admin_only = EXCLUDED.is_admin_only;


-- 6. Seed role defaults -------------------------------------------------------
-- main_admin is implicit-all in has_capability() so we don't seed rows for it
-- (keeps the table small and avoids drift if new caps are added).

-- manager: full operational access to their team-scoped modules.
INSERT INTO public.role_permission_defaults (role, capability_key) VALUES
    ('manager', 'tasks.read'),
    ('manager', 'tasks.create'),
    ('manager', 'tasks.update'),
    ('manager', 'tasks.delete'),
    ('manager', 'tasks.assign'),
    ('manager', 'tasks.ai_analyze'),

    ('manager', 'materials.read'),
    ('manager', 'materials.create'),
    ('manager', 'materials.update'),
    ('manager', 'materials.delete'),
    ('manager', 'materials.ai_analyze'),

    ('manager', 'validation_rules.read'),
    ('manager', 'validation_rules.create'),
    ('manager', 'validation_rules.update'),
    ('manager', 'validation_rules.delete'),
    ('manager', 'validation_rules.ai_analyze'),

    ('manager', 'submissions.read'),
    ('manager', 'submissions.update'),
    ('manager', 'submissions.delete'),
    ('manager', 'submissions.ai_analyze'),

    ('manager', 'announcements.read'),
    ('manager', 'announcements.create'),
    ('manager', 'announcements.update'),
    ('manager', 'announcements.delete'),
    ('manager', 'announcements.ai_analyze'),

    ('manager', 'ai_credits.read_self'),

    ('manager', 'smart_ai.chat'),
    ('manager', 'smart_ai.analytics_self'),

    ('manager', 'team_management.read'),
    ('manager', 'user_management.read')
ON CONFLICT DO NOTHING;

-- member: read-only / submit-only by default. NO validation_rules access.
INSERT INTO public.role_permission_defaults (role, capability_key) VALUES
    ('member', 'tasks.read'),

    ('member', 'materials.read'),
    ('member', 'materials.ai_analyze'),

    ('member', 'submissions.read'),
    ('member', 'submissions.create'),

    ('member', 'announcements.read'),

    ('member', 'ai_credits.read_self'),
    ('member', 'smart_ai.chat')
ON CONFLICT DO NOTHING;


-- 7. PostgREST schema cache reload -------------------------------------------
NOTIFY pgrst, 'reload schema';
