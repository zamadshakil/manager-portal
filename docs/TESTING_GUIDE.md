# Pre-Production Testing Guide

**Scope:** Validation Rules → Tasks → Submissions (21 scenarios)  
**Sample files:** All in `test-data/` at the project root  
**Roles needed:** `main_admin`, `manager`, `member` (at least one of each)

---

## Quick Reference — Test Files

| File | Chars | Purpose |
|------|-------|---------|
| `test-data/thin.txt` | 11 | Replicates the production thin-content bug |
| `test-data/boundary_minus.txt` | 19 | One below the 20-char pipeline threshold |
| `test-data/boundary_exact.txt` | 20 | Exactly at threshold — should pass to AI |
| `test-data/just_over.txt` | 21 | One above threshold |
| `test-data/pii_test.txt` | ~1 KB | Triggers Data Privacy Check rule |
| `test-data/wall_of_text.txt` | ~1.5 KB | Unstructured prose — fails formatting rules |
| `test-data/well_structured.md` | ~2 KB | Properly formatted report — should pass most rules |
| `test-data/unformatted_report.txt` | ~1.5 KB | Informal, no structure — fails Professional Language |

> **Tip:** The pipeline gate is `text.trim().length < 20` in `lib/llm/pipeline.ts`. Files with fewer than 20 extracted characters go directly to `needs_review` without ever reaching the AI — this is the root cause of the production thin-content bug.

---

## Phase 1 — Validation Rules

> **Who:** Log in as **main_admin** for global rules (R1, R4, R7); log in as **manager** for team rules (R2, R3, R5, R6, R8, R9).  
> **Where:** Dashboard → Rules → New Rule

---

### R1 — Content Length Check *(main_admin, global, enabled)*

| Field | Value |
|-------|-------|
| Rule Name | `Content Length Check` |
| Description | `Verify the document contains sufficient substantive content for meaningful review.` |
| Threshold | `55` |
| Weight | `1` |
| Enabled | ✅ ON |

**Prompt Template:**
```
Evaluate whether this document contains sufficient content for meaningful analysis.
A document with fewer than 3 paragraphs or less than 200 words should score below 50.
A thin document that is essentially empty or only contains a title/heading should score 0-20.
A well-developed document with multiple paragraphs and clear points should score 70-100.
```

---

### R2 — Professional Language *(manager, team, enabled)*

| Field | Value |
|-------|-------|
| Rule Name | `Professional Language` |
| Description | `Checks that the document uses professional, formal business language throughout.` |
| Threshold | `70` |
| Weight | `1` |
| Enabled | ✅ ON |

**Prompt Template:**
```
Evaluate the document for professional language and formal tone.
Deduct points for: slang, casual phrasing, first-person informal voice ("so basically", "a whole thing"), typos, or overly emotional language.
Award high scores for clear, concise, formal business writing.
A document written in casual conversational language with no formal structure should score 0-35.
A professionally written document with minor tone inconsistencies should score 65-80.
A fully formal, polished document should score 85-100.
```

---

### R3 — Required Sections Check *(manager, team, enabled)*

| Field | Value |
|-------|-------|
| Rule Name | `Required Sections Check` |
| Description | `Checks for the presence of Introduction, Body/Analysis, and Conclusion sections.` |
| Threshold | `75` |
| Weight | `2` |
| Enabled | ✅ ON |

**Prompt Template:**
```
Check whether the document contains all three required sections:
1. Introduction (or Executive Summary)
2. Main body or Analysis section (e.g. KPI breakdown, findings, challenges)
3. Conclusion or Recommendations

Each clearly present section earns approximately 33 points.
If all three sections are present and well-developed, score 90-100.
If two sections are present, score 55-70.
If only one section is present, score 20-40.
If none of the required sections are identifiable, score 0-15.
```

---

### R4 — Strict Formatting Standard *(main_admin, global, enabled)*

| Field | Value |
|-------|-------|
| Rule Name | `Strict Formatting Standard` |
| Description | `Enforces a very high formatting bar — numbered sections, consistent headings, page structure.` |
| Threshold | `90` |
| Weight | `3` |
| Enabled | ✅ ON |

**Prompt Template:**
```
Evaluate formatting quality strictly. The document MUST have:
- Numbered or clearly titled sections with consistent heading hierarchy
- No walls of unbroken text (paragraphs must be separated)
- No mix of bullet styles or inconsistent list formatting
- Professional layout: title, dated, structured body

Scoring:
- All formatting requirements met with no violations: 92-100
- Minor inconsistencies (1-2 issues): 75-89 (FAILS — below threshold of 90)
- Several formatting issues: 50-74 (FAILS)
- Plain text block with no structure whatsoever: 0-30 (FAILS)

Be strict. A document that "looks OK" but lacks explicit section headings should score no higher than 70.
```

> **Note:** Threshold is 90. This is deliberately difficult — only `well_structured.md` and similar polished documents should pass this rule. Most uploads will fail it.

---

### R5 — Easy Pass Baseline *(manager, team, enabled)*

| Field | Value |
|-------|-------|
| Rule Name | `Easy Pass Baseline` |
| Description | `Bare minimum check — just confirms the document is not gibberish.` |
| Threshold | `20` |
| Weight | `1` |
| Enabled | ✅ ON |

**Prompt Template:**
```
Does the document contain coherent text that appears to be intentionally written by a human?
Even rough drafts, informal notes, or short messages should score 70+.
Only score below 20 if the document is completely random characters, repeated filler text, or machine-generated noise with no coherent meaning.
```

---

### R6 — Disabled Rule *(manager, team, **disabled**)*

| Field | Value |
|-------|-------|
| Rule Name | `Disabled Rule (must not run)` |
| Description | `This rule must never appear in validation results. It is disabled.` |
| Threshold | `60` |
| Weight | `1` |
| Enabled | ❌ **OFF — leave this disabled** |

**Prompt Template:**
```
If you see this rule executing, report a bug to the development team immediately.
Return pass=false score=0 reasons=["ERROR: This rule should be disabled and must not run."]
```

> **Verification:** After any submission, check the validation results panel — R6 must never appear in any run's output.

---

### R7 — Grammar & Spelling *(main_admin, global, uses `{{TEXT}}` placeholder)*

| Field | Value |
|-------|-------|
| Rule Name | `Grammar & Spelling` |
| Description | `Evaluates spelling and grammatical accuracy using the full document text.` |
| Threshold | `65` |
| Weight | `1` |
| Enabled | ✅ ON |

**Prompt Template:**
```
Evaluate the following document for grammar and spelling errors.
---
{{TEXT}}
---
Scoring rubric:
- 90-100: Near-perfect grammar and spelling throughout
- 70-89: A few minor errors that do not impede comprehension
- 40-69: Noticeable errors that occasionally impede clarity; 10+ spelling mistakes
- 0-39: Pervasive errors throughout that make the document difficult to read

Deduct approximately 8 points per notable grammar error cluster (e.g. consistent subject-verb disagreement).
Deduct approximately 5 points per repeated spelling mistake.
```

> **Note:** This rule uses `{{TEXT}}` as a placeholder — the pipeline replaces it with the full extracted document text before sending to the AI. Verify it works by checking that the AI reasons reference specific content from the uploaded file.

---

### R8 — Data Privacy Check *(manager, team, enabled)*

| Field | Value |
|-------|-------|
| Rule Name | `Data Privacy Check` |
| Description | `Flags if the document contains personally identifiable information (PII).` |
| Threshold | `80` |
| Weight | `2` |
| Enabled | ✅ ON |

**Prompt Template:**
```
Check whether the document contains personally identifiable information (PII) such as:
- National ID / CNIC numbers (e.g. 12345-6789012-3)
- Passport numbers
- Credit card or bank account numbers
- Personal phone numbers
- Personal email addresses
- Home addresses

If ANY PII is found:
- Score: 0-25
- pass: false
- Add a flag with severity="fail" and a message listing what type of PII was detected.

If NO PII is present:
- Score: 90-100
- pass: true
- No flags needed.
```

---

### R9 — Task Instructions Test *(manager, team, enabled)*

| Field | Value |
|-------|-------|
| Rule Name | `Task Instructions Test` |
| Description | `Generic relevance check — used to verify rule selection on individual tasks works.` |
| Threshold | `60` |
| Weight | `1` |
| Enabled | ✅ ON |

**Prompt Template:**
```
Verify that the document is broadly relevant to a professional business or operational context.
A document about general work activities, reports, proposals, or analyses should score 70-100.
A completely off-topic document (e.g. a personal diary entry or song lyrics) should score 0-40.
A borderline document with mixed relevance should score 40-69.
```

---

## Phase 2 — Tasks

> **Who:** Log in as **manager**  
> **Where:** Dashboard → Tasks → Create Task

---

### T1 — Quarterly Report Submission *(happy path, all rules)*

| Field | Value |
|-------|-------|
| Team | Your team |
| Title | `Quarterly Report Submission` |
| Description | `Submit your Q3 performance report covering all KPIs, challenges, and next-quarter targets.` |
| Instructions | `The report must include: an executive summary, KPI breakdown table, challenges section, and at least three actionable next-quarter targets. Minimum length: 400 words.` |
| Due Date | Today + 7 days, 23:59 |
| Allow Late | ✅ ON |
| Late Deadline | Today + 10 days, 23:59 |
| Require Late Reason | ✅ ON |
| Assign Mode | All members |
| Rules | Leave default (all enabled rules run) |

---

### T2 — Weekly Ops Update — No Late *(strict deadline)*

| Field | Value |
|-------|-------|
| Title | `Weekly Ops Update — No Late` |
| Description | `This week's operational update. Strict deadline — no extensions.` |
| Instructions | `Summarise team activity, blockers, and next-week priorities in bullet form. Keep it concise.` |
| Due Date | Today + 2 days, 17:00 |
| Allow Late | ❌ OFF |
| Assign Mode | All members |
| Rules | Default |

---

### T3 — Draft Proposal (Late-Friendly) *(deadline already passed — tests late submission flow)*

| Field | Value |
|-------|-------|
| Title | `Draft Proposal (Late-Friendly)` |
| Description | `The main deadline has passed but the grace period is still open. Submit your draft proposal.` |
| Instructions | `The proposal must state: problem statement, proposed solution, estimated timeline.` |
| Due Date | **Today minus 1 hour** ← set this deliberately in the past |
| Allow Late | ✅ ON |
| Late Deadline | Today + 2 days, 23:59 |
| Require Late Reason | ✅ ON |
| Assign Mode | All members |
| Rules | **Select only R2 (Professional Language) and R3 (Required Sections Check)** |

> After creating, verify the due date shows as already passed in the task list.

---

### T4 — Expired Hard Deadline *(completely closed — hard rejection)*

| Field | Value |
|-------|-------|
| Title | `Expired Hard Deadline` |
| Description | `This task is fully past its deadline. Any submission attempt must be rejected.` |
| Instructions | `(any placeholder text)` |
| Due Date | **Today minus 3 days** |
| Allow Late | ❌ OFF |
| Assign Mode | All members |
| Rules | Default |

---

### T5 — Formatting Audit *(single strict rule, single assignee)*

| Field | Value |
|-------|-------|
| Title | `Formatting Audit Submission` |
| Description | `Submit any document to test whether the Strict Formatting Standard alone correctly rejects unformatted files.` |
| Instructions | `Document must use clearly numbered sections, consistent headings, and no unbroken text walls.` |
| Due Date | Today + 5 days |
| Allow Late | ✅ ON |
| Late Deadline | Today + 8 days |
| Require Late Reason | ✅ ON |
| Assign Mode | **Selected — pick exactly ONE specific member** |
| Rules | **Select only R4 (Strict Formatting Standard)** |

---

### T6 — Free-Form Note (No Rules) *(tests "no rules configured" path)*

| Field | Value |
|-------|-------|
| Title | `Free-Form Note (No Rules)` |
| Description | `Submit a free-form note. No AI validation is attached to this task.` |
| Instructions | *(leave blank)* |
| Due Date | Today + 3 days |
| Allow Late | ✅ ON |
| Late Deadline | Today + 5 days |
| Assign Mode | All members |
| Rules | **Show rules section → deselect ALL rules (leave none checked)** |

> **Important:** The task form must show the rules section (tick the "show rules" toggle if present) and explicitly deselect every rule. This sends `rules_section_shown=1` with zero checked IDs, which stores `rule_ids=[]` — different from `null` (which means "all rules").

---

## Phase 3 — Submissions

> **Who:** Log in as **member** unless stated otherwise.  
> **Where:** Dashboard → Tasks → [task name] → Submit  
> **After upload:** Wait for the pipeline status badge to progress: `queued → parsing → validating → [final status]`

---

### GROUP A — Happy Path

#### S1 — Valid Well-Structured Document *(expects: passed)*

| Field | Value |
|-------|-------|
| Task | T1 (Quarterly Report Submission) |
| File | `test-data/well_structured.md` |
| Title | `Q3 2025 Performance Report` |

**What to verify:**
- Status reaches `passed`
- Score ≥ 75
- R4 (Strict Formatting) may flag with `needs_review` depending on AI judgment — this is expected given its 90 threshold
- `validation_runs` table has rows for each enabled rule (check via admin or submissions detail page)
- R6 (Disabled Rule) does **not** appear in results

---

#### S2 — Valid Plain Text, Sufficient Length *(expects: validated, likely passed)*

| Field | Value |
|-------|-------|
| Task | T1 |
| File | `test-data/unformatted_report.txt` |
| Title | `Operations Summary TXT` |

**What to verify:**
- Passes the thin-content gate (file is ~1.5 KB, well over 20 chars)
- R2 (Professional Language) likely fails — document is intentionally informal
- R4 (Strict Formatting) likely fails — no headings
- R8 (Data Privacy) likely passes — no PII
- Overall status probably `failed` or `needs_review` — this is intentional

---

### GROUP B — Thin Content Bug (Production Bug + Boundary Conditions)

> These four tests specifically target the `text.trim().length < 20` gate in `lib/llm/pipeline.ts:266`.  
> **S3 and S4 must never reach the AI.** S5 and S6 must reach the AI.

#### S3 — TXT with 2 words — exact production bug *(expects: needs_review, no AI run)*

| Field | Value |
|-------|-------|
| Task | T1 |
| File | `test-data/thin.txt` ("hello world" — 11 chars) |
| Title | `Thin Content Bug Replica` |

**What to verify:**
- Status = `needs_review`
- Flag message contains: *"Could not extract enough text from the file."*
- **Zero `validation_runs` rows** for this submission (AI never ran)
- Score = `null`

---

#### S4 — TXT with exactly 19 characters *(expects: needs_review)*

| Field | Value |
|-------|-------|
| Task | T1 |
| File | `test-data/boundary_minus.txt` ("This is nineteen!!!" — 19 chars) |
| Title | `Boundary 19 Chars Test` |

**What to verify:**
- Same as S3 — still below the 20-char threshold
- Status = `needs_review`, flag = extract failure, no AI run

---

#### S5 — TXT with exactly 20 characters *(expects: AI validation runs)*

| Field | Value |
|-------|-------|
| Task | T1 |
| File | `test-data/boundary_exact.txt` ("This is twenty chars" — 20 chars) |
| Title | `Boundary 20 Chars Test` |

**What to verify:**
- **Passes** the thin-content gate (`text.trim().length < 20` is false for 20 chars)
- AI validation runs — `validation_runs` rows are created
- Score will be very low (content is meaningless) — likely `failed`
- This confirms the boundary is `>= 20`, not `> 20`

---

#### S6 — TXT with 21 characters *(expects: AI validation runs)*

| Field | Value |
|-------|-------|
| Task | T1 |
| File | `test-data/just_over.txt` ("This is twenty-one ch" — 21 chars) |
| Title | `Just Over Threshold` |

**What to verify:**
- Proceeds to AI validation (same as S5)
- Confirms the gate is stable above the threshold

---

### GROUP C — File Type Edge Cases

#### S7 — PNG Image (Vision OCR Path) *(expects: needs_review or passed depending on image)*

| Field | Value |
|-------|-------|
| Task | T1 |
| File | Take a screenshot of any text-heavy webpage or document, save as `.png` |
| Title | `Vision OCR Test` |

**What to verify:**
- Pipeline takes the vision path (no `extractText` call)
- If image has readable text (≥ 20 chars): AI validation runs
- If image is blank/low-quality: `needs_review` with vision error flag
- Check logs for `[pipeline] image detected — using vision model`

---

#### S8 — JPEG — Near-Blank Image *(expects: needs_review)*

| Field | Value |
|-------|-------|
| Task | T1 |
| File | A mostly blank JPEG (e.g. photo of a wall, white paper, or dark room) |
| Title | `Blank Image Test` |

**What to verify:**
- Vision model runs but extracted text is either empty or < 20 chars
- Status = `needs_review`
- Flag references image processing

---

#### S9 — Markdown File, Full Structure *(expects: passed)*

| Field | Value |
|-------|-------|
| Task | T1 |
| File | `test-data/well_structured.md` (already created) |
| Title | `Markdown Structured Report` |

**What to verify:**
- MIME type `text/markdown` is accepted
- Text is extracted cleanly (headings, tables, bullet points all parsed)
- AI receives the full document text
- R3 (Required Sections Check) should pass — document has all 3 sections
- R8 (Data Privacy) should pass — no PII

---

### GROUP D — Deadline / Late Submission Scenarios

#### S10 — Submit to T2 Before Deadline *(expects: passed)*

| Field | Value |
|-------|-------|
| Task | T2 (Weekly Ops Update — No Late) |
| File | `test-data/well_structured.md` |
| Title | `On-Time Ops Update` |
| Timing | Submit while due date is still in the future |

**What to verify:**
- `is_late = false` on the submission row
- Assignment status = `submitted`
- No late-related flags

---

#### S11 — Late Submission with Valid Reason (T3) *(expects: accepted as late)*

| Field | Value |
|-------|-------|
| Task | T3 (Draft Proposal — deadline already passed, grace period open) |
| File | `test-data/well_structured.md` |
| Title | `Late Draft Proposal` |
| Late Reason | `I had a family emergency during the submission window and could not access the portal in time.` |

**What to verify:**
- System accepts submission despite missed main deadline
- `is_late = true` on the submission
- Assignment status = `late_submitted`
- AI pipeline still runs normally (late is a metadata flag, not a blocker)

---

#### S12 — Late Submission, Missing Reason *(expects: rejected)*

| Field | Value |
|-------|-------|
| Task | T3 |
| File | `test-data/well_structured.md` |
| Title | `Late No Reason` |
| Late Reason | *(leave completely blank)* |

**What to verify:**
- Error: *"Late submission requires a reason (at least 8 characters)."*
- No submission row created in DB

---

#### S13 — Attempt Submission After Hard Deadline (T4) *(expects: hard rejection)*

| Field | Value |
|-------|-------|
| Task | T4 (Expired Hard Deadline — 3 days ago, no late allowed) |
| File | Any valid file |
| Title | `Past Deadline Attempt` |

**What to verify:**
- Error: *"Submission failed: the deadline has passed and late submissions are not allowed."*
- No submission row created

---

#### S14 — Double Submission *(expects: rejected on second attempt)*

| Field | Value |
|-------|-------|
| Task | T1 (already submitted via S1) |
| File | Any new file |
| Title | `Duplicate Submission Attempt` |

**What to verify:**
- Error: *"You have already submitted this task."*
- Assignment status remains `submitted` (unchanged)

---

### GROUP E — Permission / Role Scenarios

#### S15 — Member Tries to Create a Task *(expects: blocked)*

| Role | member |
|------|--------|
| Action | Navigate to `/dashboard/tasks` and attempt to open the task creation form or call the create action |

**What to verify:**
- Task creation form is either hidden or blocked
- If accessible, submitting returns: *"You do not have permission to create tasks for this team."*

---

#### S16 — Manager Tries to Edit main_admin's Global Rule *(expects: blocked)*

| Role | manager |
|------|--------|
| Action | Dashboard → Rules → click Edit on R1 or R4 (created by main_admin) |

**What to verify:**
- Edit form either doesn't appear or shows an error on save
- Error: *"Managers cannot edit rules created by the main admin."*

---

#### S17 — Member Submits to Task Not Assigned to Them *(expects: blocked)*

| Role | A **second** member account (NOT the one assigned to T5) |
|------|--------|
| Task | T5 (assigned to only one specific member) |
| Action | Navigate to T5 and attempt to submit |

**What to verify:**
- Error: *"You are not assigned to this task."*
- No submission row created

---

### GROUP F — Score Boundary & No-Rules Edge Cases

#### S18 — Submit to No-Rules Task (T6) *(expects: needs_review with info flag)*

| Field | Value |
|-------|-------|
| Task | T6 (Free-Form Note, no rules attached) |
| File | `test-data/wall_of_text.txt` |
| Title | `No Rules Submission` |

**What to verify:**
- Status = `needs_review`
- Flag message: *"No validation rules configured."*
- Score = `null`
- No `validation_runs` rows

---

#### S19 — Document That Fails Strict Formatting Rule (T5) *(expects: failed)*

| Field | Value |
|-------|-------|
| Task | T5 (Formatting Audit — R4 only, threshold 90) |
| File | `test-data/wall_of_text.txt` (unbroken text, no headings) |
| Title | `Unformatted Wall of Text` |
| Role | The one member assigned to T5 |

**What to verify:**
- R4 (Strict Formatting, threshold 90) runs
- AI score likely 10-35 → **below** threshold → `pass=false`
- Submission status = `failed`
- Flags include specific formatting failure reasons from the AI

---

#### S20 — Document With PII (T1) *(expects: failed, severity=fail flags)*

| Field | Value |
|-------|-------|
| Task | T1 |
| File | `test-data/pii_test.txt` |
| Title | `PII Test Document` |

**What to verify:**
- R8 (Data Privacy Check, threshold 80) fires
- AI detects the CNIC, phone number, email, passport number in the document
- R8 score: 0-25 → `pass=false`
- Flag with `severity=fail` listing type of PII found
- Overall submission status = `failed` or `needs_review`
- Check that the AI reasons specifically mention the types of PII present (not hallucinated)

---

#### S21 — Valid Document, Only R4 Attached — Passes *(expects: passed)*

| Field | Value |
|-------|-------|
| Task | T5 (R4 only) |
| File | `test-data/well_structured.md` |
| Title | `Formatted Report for Audit` |
| Role | The one member assigned to T5 |

> **Note:** Submit S21 *before* S19 on this task (or use a fresh assignment). The member can only submit once.

**What to verify:**
- R4 runs
- AI score ≥ 90 (document has explicit headings, sections, no text walls)
- Status = `passed`
- This confirms R4 can pass — it's strict but not broken

---

## Phase 4 — Post-Run Verification Checklist

After completing all scenarios, verify the following cross-cutting concerns:

| # | Check | How to Verify | Expected |
|---|-------|---------------|----------|
| 1 | R6 (disabled) never runs | Submission detail → Validation Results | R6 rule_id absent from all runs |
| 2 | S3 & S4 thin content | Submission detail → Flags tab | Status `needs_review`, flag = "Could not extract enough text", `validation_runs` count = 0 |
| 3 | S5 & S6 boundary pass | Submission detail → Validation Results | `validation_runs` rows exist for each enabled rule |
| 4 | S11 late assignment status | Admin panel → Task T3 → Assignments | Member row shows `late_submitted` |
| 5 | S14 double submit blocked | Check submission count for T1 assignee | Only 1 submission row exists |
| 6 | S18 no-rules result | Submission detail | `score = null`, flag message mentions "no validation rules" |
| 7 | Activity log completeness | Dashboard → Activity | All task creates, submissions, and rule changes logged |
| 8 | AI credits deducted | Admin → AI Credits panel | `used_this_period` increments for every submission that ran the AI |
| 9 | `{{TEXT}}` placeholder (R7) | Any submission detail → R7 result | AI reasons cite specific sentences from the uploaded document |
| 10 | T3 rule selection | T3 submissions | Only R2 and R3 appear in validation_runs (not R1, R4, R7, R8, R9) |

---

## Known Edge Cases Mapped to Scenarios

| Production Risk | Test Scenario |
|-----------------|---------------|
| TXT with thin content (2 words) blocks AI without clear error | S3, S4 |
| Boundary condition — exactly 20 chars either blocks or proceeds | S5, S6 |
| Scanned PDF / image with no embedded text | S7, S8 |
| Double submission by same member | S14 |
| Late submission without reason crashes submit | S12 |
| PII in document not caught by rules | S20 |
| Manager editing admin-created rules | S16 |
| Disabled rule leaking into pipeline | All (check via checklist item 1) |
| Task with no rules silently marks `passed` instead of flagging | S18 |
| Member submitting to another member's task | S17 |
| Submission after fully expired deadline (no late) | S13 |
| `{{TEXT}}` placeholder not substituted | S1, S2 (check R7 reasons) |
