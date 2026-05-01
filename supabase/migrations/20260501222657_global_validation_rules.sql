-- Make validation_rules team_id optional to support global rules
ALTER TABLE public.validation_rules ALTER COLUMN team_id DROP NOT NULL;
