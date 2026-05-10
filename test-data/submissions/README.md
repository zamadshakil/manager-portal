# Submission Files — Upload Mapping

All files in this folder + `test-data/` root are ready to upload through the portal.
Log in as the **member** account (`zamadshakil@gmail.com`) for all uploads unless stated otherwise.

---

## Complete Upload Map

| # | Scenario | File to Upload | Task | Title to Enter | Role | Expected Result |
|---|----------|---------------|------|----------------|------|-----------------|
| S1 | Happy path — well structured | `submissions/S01_quarterly_report_pass.md` | **T1** Quarterly Report | `Q3 Operations Report — Structured` | member | `passed` |
| S2 | Informal/no structure — fails R2+R3 | `../wall_of_text.txt` | **T1** | `Q3 Report Informal Draft` | member | `failed` / `needs_review` |
| S3 | **Thin content bug** (11 chars) | `../thin.txt` | **T1** | `Thin Content Test` | member | `needs_review` — no AI ran |
| S4 | Boundary −1 (19 chars) | `../boundary_minus.txt` | **T1** | `Boundary 19 Chars` | member | `needs_review` — no AI ran |
| S5 | Boundary exact (20 chars) | `../boundary_exact.txt` | **T1** | `Boundary 20 Chars` | member | AI runs, low score |
| S6 | Just over (21 chars) | `../just_over.txt` | **T1** | `Boundary 21 Chars` | member | AI runs, low score |
| S7 | PNG image (vision path) | any `.png` screenshot | **T1** | `Vision OCR Test` | member | `passed` or `needs_review` (depends on image) |
| S8 | JPEG near-blank (vision fails) | blank/dark `.jpg` photo | **T1** | `Blank Image Test` | member | `needs_review` |
| S9 | Markdown structured | `../well_structured.md` | **T1** | `Markdown Report` | member | `passed` |
| S10 | On-time ops update | `submissions/S10_weekly_ops_update.txt` | **T2** Weekly Ops | `Weekly Ops Update May 11` | member | `passed` |
| S11 | Late — WITH reason | `submissions/S11_draft_proposal.md` | **T3** Draft Proposal | `Draft Proposal — Late With Reason` | member | accepted as late, AI runs |
| S12 | Late — NO reason (rejected) | `submissions/S11_draft_proposal.md` | **T3** | `Draft Proposal — Late No Reason` | member | ❌ error: reason required |
| S13 | Expired deadline — hard rejected | any file | **T4** Expired Deadline | `Attempt Past Hard Deadline` | member | ❌ error: deadline passed |
| S14 | Duplicate submit (T1 already done) | any file | **T1** | `Duplicate Submit Attempt` | member | ❌ error: already submitted |
| S15 | Member tries to create a task | — | — | navigate to /dashboard/tasks | member | ❌ blocked in UI |
| S16 | Manager edits admin's global rule | — | R1 or R4 in Rules page | click Edit on Content Length Check | manager | ❌ error: cannot edit admin rule |
| S17 | Wrong member submits to T5 | `../well_structured.md` | **T5** Formatting Audit | `Wrong Member Test` | **different member / admin** | ❌ error: not assigned |
| S18 | No-rules task | `submissions/S18_freeform_note.txt` | **T6** Free-Form Note | `Internal Team Note` | member | `needs_review` — "No rules configured" |
| S19 | Fails strict formatting (R4) | `submissions/S19_formatting_fail.txt` | **T5** | `Unformatted Formatting Doc` | **assigned member** | `failed` — R4 score < 90 |
| S20 | PII detected | `../pii_test.txt` | **T1** | `PII Test Document` | member | `failed` — R8 severity=fail |
| S21 | Passes strict formatting (R4) | `submissions/S21_formatted_audit_pass.md` | **T5** | `Formatting Audit Report` | **assigned member** | `passed` — R4 score ≥ 90 |

---

## Order of Execution

Run scenarios in this order to avoid conflicts:

### Step 1 — T1 Submissions (S1 through S9, S20)
Upload each in sequence. After each upload, **wait for the pipeline badge** to reach a final state before uploading the next one (avoids rate-limit collisions).

> ⚠️ S3, S4, S5, S6 are intentionally thin/trivial files. Upload them to T1 in order.

### Step 2 — T2 Submission (S10)
Upload `S10_weekly_ops_update.txt` to T2. Submit **before the deadline** (due in 2 days).

### Step 3 — T3 Submissions (S12 then S11)
- Do **S12 first** (same file, no late reason) → should be rejected
- Then do **S11** (same file, with late reason) → should be accepted

### Step 4 — T4 Submission (S13)
Upload any file to T4. Should be immediately rejected.

### Step 5 — S14 Double Submit
Try to re-upload anything to T1 (already submitted in S1). Should be rejected.

### Step 6 — T5 Submissions (S19 then S21)
- **Assigned member only** (zamadshakil@gmail.com)
- Do S19 first (formatting fail), then — since they can only submit once — note the result
- S21 uses the same task/member slot; run this on a fresh task assignment or compare S19 and S21 as separate test runs

> ⚠️ T5 is assigned to one member only. If you want to test both S19 (fail) and S21 (pass) separately, create a second T5-style task with R4 only for the second run.

### Step 7 — T6 Submission (S18)
Upload `S18_freeform_note.txt` to T6.

### Step 8 — Permission Tests (S15, S16, S17)
- S15: log in as member, attempt task creation
- S16: log in as manager, attempt to edit R1 "Content Length Check"
- S17: log in as a **different account** (not zamadshakil), attempt to submit to T5

---

## What Each File Tests in the AI

| File | R1 Content | R2 Language | R3 Sections | R4 Formatting | R8 Privacy |
|------|-----------|-------------|-------------|---------------|------------|
| S01 | ✅ Pass | ✅ Pass | ✅ Pass | ⚠️ Borderline | ✅ Pass |
| S02 | ✅ Pass | ❌ Fail | ❌ Fail | ❌ Fail | ✅ Pass |
| S10 | ✅ Pass | ✅ Pass | ⚠️ Partial | ❌ Fail | ✅ Pass |
| S11 | ✅ Pass | ✅ Pass | ✅ Pass | ⚠️ Borderline | ✅ Pass |
| S18 | — | — | — | — | — (no rules) |
| S19 | ✅ Pass | ✅ Pass | ❌ Fail | ❌ FAIL (0-30) | ✅ Pass |
| S21 | ✅ Pass | ✅ Pass | ✅ Pass | ✅ PASS (90+) | ✅ Pass |
| pii_test | ✅ Pass | ✅ Pass | ✅ Pass | ⚠️ Some | ❌ FAIL |
| well_structured | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass |
| wall_of_text | ⚠️ Low | ❌ Fail | ❌ Fail | ❌ Fail | ✅ Pass |
| thin/boundary | ❌ No AI | ❌ No AI | ❌ No AI | ❌ No AI | ❌ No AI |
