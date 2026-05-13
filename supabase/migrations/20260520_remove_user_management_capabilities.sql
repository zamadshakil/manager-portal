-- Remove the user_management.* capabilities from the access-control catalog.
-- The matrix UI is data-driven from permission_definitions, so deleting these
-- rows hides the "User management" section. ON DELETE CASCADE on
-- role_permission_defaults / user_permission_overrides cleans up dependents.

DELETE FROM public.user_permission_overrides
 WHERE capability_key IN (
   'user_management.read',
   'user_management.write',
   'user_management.permissions'
 );

DELETE FROM public.role_permission_defaults
 WHERE capability_key IN (
   'user_management.read',
   'user_management.write',
   'user_management.permissions'
 );

DELETE FROM public.permission_definitions
 WHERE key IN (
   'user_management.read',
   'user_management.write',
   'user_management.permissions'
 );

NOTIFY pgrst, 'reload schema';
