-- ============================================================================
-- Seed demo data: teams + default validation rules.
-- Auth users are NOT seeded here; they are provisioned via the admin invite
-- flow once an admin signs in for the first time. The first auth.users insert
-- automatically becomes main_admin (handled in 002_helper_functions.sql).
-- ============================================================================

-- Default teams (idempotent on name).
insert into public.teams (name, description)
values
  ('Operations',  'Day-to-day execution and field reports'),
  ('Engineering', 'Product engineering and technical proposals'),
  ('Field Ops',   'Inspections, audits, and on-site documentation')
on conflict do nothing;

-- Default global validation rules (apply to every team that hasn't overridden).
do $$
declare
  t record;
begin
  for t in select id from public.teams loop
    insert into public.validation_rules (team_id, rule_name, description, prompt_template, threshold, weight, enabled)
    values
      (
        t.id,
        'Completeness Check',
        'Verifies the submission contains all required sections (summary, findings, recommendations).',
        $rule$You are an analyst reviewing a document. Check whether the document contains:
1. An executive summary
2. Concrete findings with supporting evidence
3. Actionable recommendations
Document text:
"""
{{TEXT}}
"""
Respond with JSON: { "pass": boolean, "score": number 0-100, "reasons": string[], "flags": string[] }$rule$,
        70, 1.0, true
      ),
      (
        t.id,
        'Logical Consistency',
        'Detects contradictions, unsupported claims, or logical gaps.',
        $rule$Review the document for internal contradictions, unsupported claims, or reasoning gaps.
Document text:
"""
{{TEXT}}
"""
Respond with JSON: { "pass": boolean, "score": number 0-100, "reasons": string[], "flags": string[] }$rule$,
        65, 1.0, true
      ),
      (
        t.id,
        'Tone & Professionalism',
        'Ensures the writing is professional, neutral, and free of inappropriate content.',
        $rule$Evaluate professional tone, clarity, and absence of inappropriate or biased language.
Document text:
"""
{{TEXT}}
"""
Respond with JSON: { "pass": boolean, "score": number 0-100, "reasons": string[], "flags": string[] }$rule$,
        75, 0.5, true
      )
    on conflict do nothing;
  end loop;
end $$;
