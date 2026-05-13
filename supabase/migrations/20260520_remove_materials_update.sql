-- Remove the materials.update capability from the system.

DELETE FROM public.user_permission_overrides WHERE capability_key = 'materials.update';
DELETE FROM public.role_permission_defaults   WHERE capability_key = 'materials.update';
DELETE FROM public.permission_definitions     WHERE key            = 'materials.update';

NOTIFY pgrst, 'reload schema';
