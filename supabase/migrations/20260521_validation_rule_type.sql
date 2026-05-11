-- ============================================================================
-- Validation rule_type — distinguishes binary checks from scored quality rules
-- ============================================================================
--
-- The validation pipeline forces a 0-100 rubric onto every rule, which works
-- well for substantive quality rules ("how well does the document explain X?")
-- but produces wildly inconsistent scores for binary checks ("does the
-- document contain the word 'hello'?").
--
-- Adding `rule_type` lets the LLM prompt branch:
--   - 'binary': yes/no answer with evidence; score is 100 (pass) or 0 (fail)
--   - 'scored': existing 0-100 rubric (default for backward compatibility)
--
-- Existing rows default to 'scored' so no behaviour changes for any team that
-- doesn't explicitly opt into 'binary'.

do $$ begin
  create type public.validation_rule_type as enum ('scored', 'binary');
exception when duplicate_object then null; end $$;

alter table public.validation_rules
  add column if not exists rule_type public.validation_rule_type
  not null default 'scored';

-- Surface the column to PostgREST clients immediately.
notify pgrst, 'reload schema';
