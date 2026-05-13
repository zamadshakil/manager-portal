-- Remove the validation_rules.ai_analyze capability from the access-control catalog.
-- The matrix UI is data-driven from permission_definitions, so deleting this
-- row hides the entry under "Validation rules". ON DELETE CASCADE on
-- role_permission_defaults / user_permission_overrides cleans up dependents.

DELETE FROM public.user_permission_overrides
 WHERE capability_key = 'validation_rules.ai_analyze';

DELETE FROM public.role_permission_defaults
 WHERE capability_key = 'validation_rules.ai_analyze';

DELETE FROM public.permission_definitions
 WHERE key = 'validation_rules.ai_analyze';

NOTIFY pgrst, 'reload schema';
