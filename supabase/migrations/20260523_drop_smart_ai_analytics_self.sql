-- Drop the unused smart_ai.analytics_self capability.
--
-- It was seeded in 20260509_granular_access_control.sql but no app code or
-- RLS policy ever reads it. Removing it cleans up the permissions matrix UI.
--
-- role_permission_defaults and user_permission_overrides both reference
-- permission_definitions(key) ON DELETE CASCADE, so the manager default row
-- and any user overrides are removed automatically.

DELETE FROM public.permission_definitions WHERE key = 'smart_ai.analytics_self';
