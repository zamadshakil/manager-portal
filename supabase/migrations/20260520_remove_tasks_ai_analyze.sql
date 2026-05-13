-- Remove the tasks.ai_analyze capability from the system.

DELETE FROM public.user_permission_overrides WHERE capability_key = 'tasks.ai_analyze';
DELETE FROM public.role_permission_defaults   WHERE capability_key = 'tasks.ai_analyze';
DELETE FROM public.permission_definitions     WHERE key            = 'tasks.ai_analyze';

NOTIFY pgrst, 'reload schema';
