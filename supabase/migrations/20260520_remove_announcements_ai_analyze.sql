-- Remove the announcements.ai_analyze capability from the system.
-- Announcements are always available to Smart AI for users who can read them
-- (no separate ai_analyze gate needed).

DELETE FROM public.user_permission_overrides WHERE capability_key = 'announcements.ai_analyze';
DELETE FROM public.role_permission_defaults   WHERE capability_key = 'announcements.ai_analyze';
DELETE FROM public.permission_definitions     WHERE key            = 'announcements.ai_analyze';

NOTIFY pgrst, 'reload schema';
