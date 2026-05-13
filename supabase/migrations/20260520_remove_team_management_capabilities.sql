-- Remove the team_management.read and team_management.write capabilities.

DELETE FROM public.user_permission_overrides WHERE capability_key IN ('team_management.read', 'team_management.write');
DELETE FROM public.role_permission_defaults   WHERE capability_key IN ('team_management.read', 'team_management.write');
DELETE FROM public.permission_definitions     WHERE key            IN ('team_management.read', 'team_management.write');

NOTIFY pgrst, 'reload schema';
