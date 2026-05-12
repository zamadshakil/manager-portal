# E-Commerce Platform Testing Guide

**Scope:** 10 Validation Rules · 8 Tasks · 12 Sample Submissions  
**Sample files:** `docs/test-submissions/`  
**Roles needed:** `main_admin` (create global rules), `manager` (create tasks), `member` (submit)  
**Platform focus:** E-commerce business workflows

---

## Quick-Reference Map

| Rule | Type | Domain | Tasks using it |
|------|------|--------|----------------|
| R1 — Product Listing Completeness | scored | Product | T1, T4 |
| R2 — Product Description Quality | scored | Product | T1 |
| R3 — SKU Format Check | binary | Product | T1, T4, T8 |
| R4 — Order Report Completeness | scored | Orders | T2, T4, T7 |
| R5 — Fulfillment Timeline Adherence | scored | Orders | T2 |
| R6 — Pricing Format Validator | binary | Orders | T2, T7 |
| R7 — Customer Feedback Analysis Quality | scored | Customer | T5 |
| R8 — Campaign Performance Report | scored | Customer | T6 |
| R9 — Return Policy Mention | binary | Customer | T5, T7 |
| R10 — Compliance Disclaimer Present | binary | All | T5, T6 |

---

## Phase 1 — Validation Rules

> **Where:** Dashboard → Rules → New Rule  
> **Who:** Log in as **main_admin** to create global rules (visible to all teams).

Copy each block below exactly into the form fields.

---

### R1 — Product Listing Completeness

| Field | Value |
|-------|-------|
| Rule Name | `Product Listing Completeness` |
| Description | `Checks that a product listing contains all mandatory fields: title, SKU, price, category, and a product description of at least two sentences.` |
| Rule Type | `scored` |
| Threshold | `70` |
| Weight | `3` |
| Enabled | ✅ Yes |

**Prompt Template (paste into the large text box):**
```
You are a quality-control reviewer for an e-commerce catalog team.

Evaluate the submitted document and score it from 0 to 100 based on how completely it contains the following mandatory product listing fields:

1. Product Title — a clear, descriptive name (not just a single word)
2. SKU — a product identifier (any alphanumeric code)
3. Price — a numeric value with a currency symbol (e.g. $, £, €)
4. Category — the product category or department
5. Product Description — at least two full sentences describing the product

Scoring guide:
- 5 out of 5 fields present and complete → 90–100
- 4 out of 5 fields → 70–89
- 3 out of 5 fields → 45–69
- 2 or fewer fields → 0–44

Also flag any field that is missing or clearly incomplete.
```

---

### R2 — Product Description Quality

| Field | Value |
|-------|-------|
| Rule Name | `Product Description Quality` |
| Description | `Evaluates whether a product description is detailed, engaging, and includes key selling points, dimensions or specs, and target audience.` |
| Rule Type | `scored` |
| Threshold | `65` |
| Weight | `2` |
| Enabled | ✅ Yes |

**Prompt Template:**
```
You are a senior e-commerce copywriter reviewing a product description.

Score the product description from 0 to 100 based on the following criteria:

1. Key selling points — does the description highlight at least two benefits or features? (25 pts)
2. Specifications — does it include at least one measurable spec (dimensions, weight, material, capacity, etc.)? (25 pts)
3. Target audience — does it indicate who the product is for? (20 pts)
4. Clarity and readability — is the text well-structured and free of obvious errors? (20 pts)
5. Call to action or use case — does it suggest how/when to use the product? (10 pts)

Add the scores. Return the total out of 100. Flag any missing element.
```

---

### R3 — SKU Format Check

| Field | Value |
|-------|-------|
| Rule Name | `SKU Format Check` |
| Description | `Binary check: the document must contain at least one SKU in the format LETTERS-DIGITS (e.g. PROD-001, SHOE-4521, ELEC-10023).` |
| Rule Type | `binary` |
| Threshold | `100` |
| Weight | `2` |
| Enabled | ✅ Yes |

**Prompt Template:**
```
You are a catalog data validator for an e-commerce platform.

Check whether the submitted document contains at least one SKU in the standard format: 2–6 uppercase letters, a hyphen, then 2–6 digits (examples: PROD-001, SHOE-4521, ELEC-10023, CAT-99).

Answer ONLY:
- PASS — if at least one valid SKU matching the pattern is found. Quote the SKU you found.
- FAIL — if no such SKU is present. State clearly: "No valid SKU found."

Do not award partial credit. This is a strict binary check.
```

---

### R4 — Order Report Completeness

| Field | Value |
|-------|-------|
| Rule Name | `Order Report Completeness` |
| Description | `Checks that an order processing report includes: order IDs, customer names or IDs, order totals, status for each order, and a report date.` |
| Rule Type | `scored` |
| Threshold | `75` |
| Weight | `3` |
| Enabled | ✅ Yes |

**Prompt Template:**
```
You are an operations manager reviewing a daily order processing report for an e-commerce business.

Score the report from 0 to 100 based on the presence of the following required fields:

1. Report Date — the date this report covers (20 pts)
2. Order IDs — unique identifiers for each order listed (20 pts)
3. Customer information — customer name or customer ID for each order (15 pts)
4. Order Total — a monetary total for each order, with currency (20 pts)
5. Order Status — current status of each order (e.g. Pending, Processing, Shipped, Delivered, Cancelled) (25 pts)

Deduct points for:
- Missing fields for some but not all orders (proportional deduction)
- Totals without currency symbols (-5 pts)
- No report date (-15 pts immediately)

Return a score out of 100 and list any missing required fields.
```

---

### R5 — Fulfillment Timeline Adherence

| Field | Value |
|-------|-------|
| Rule Name | `Fulfillment Timeline Adherence` |
| Description | `Scored check that the fulfillment report documents order-to-ship timelines and flags any orders exceeding the 48-hour processing SLA.` |
| Rule Type | `scored` |
| Threshold | `70` |
| Weight | `2` |
| Enabled | ✅ Yes |

**Prompt Template:**
```
You are a fulfillment analyst for an e-commerce company with a 48-hour order processing SLA.

Review the submitted fulfillment or order report and score it from 0 to 100:

1. Processing dates present — does each order show an order-received date AND a shipped/dispatched date? (30 pts)
2. SLA compliance documented — are any orders flagged that exceeded 48 hours from order to dispatch? (25 pts)
3. Reason for delays — are delay reasons provided for any late orders? (25 pts)
4. Summary statistics — does the report include overall on-time rate or total orders processed? (20 pts)

Return a score out of 100. List any orders that appear to have exceeded the 48-hour SLA if dates allow you to determine this. Flag if timeline data is entirely absent.
```

---

### R6 — Pricing Format Validator

| Field | Value |
|-------|-------|
| Rule Name | `Pricing Format Validator` |
| Description | `Binary check: every price mentioned in the document must include a currency symbol and use a decimal format (e.g. $29.99, £149.00).` |
| Rule Type | `binary` |
| Threshold | `100` |
| Weight | `2` |
| Enabled | ✅ Yes |

**Prompt Template:**
```
You are a pricing data validator for an e-commerce platform.

Check the submitted document for any prices or monetary values. Every price MUST:
1. Include a currency symbol ($, £, €, or another recognized symbol) immediately before or after the number
2. Use a decimal format with exactly two decimal places (e.g. $29.99, £149.00, €0.50)

Answer ONLY:
- PASS — if ALL prices in the document follow this format. Quote two example prices you found.
- FAIL — if ANY price is missing a currency symbol OR does not use two decimal places. Quote the offending price and explain the violation.

If the document contains no prices at all, answer FAIL and state: "No prices found in document."
```

---

### R7 — Customer Feedback Analysis Quality

| Field | Value |
|-------|-------|
| Rule Name | `Customer Feedback Analysis Quality` |
| Description | `Evaluates a customer feedback or review analysis report for depth: sentiment breakdown, recurring themes, verbatim examples, and actionable recommendations.` |
| Rule Type | `scored` |
| Threshold | `65` |
| Weight | `2` |
| Enabled | ✅ Yes |

**Prompt Template:**
```
You are a customer experience analyst reviewing a feedback analysis report for an e-commerce brand.

Score the report from 0 to 100 based on these criteria:

1. Sentiment breakdown — does the report classify feedback as positive/neutral/negative with percentages or counts? (25 pts)
2. Recurring themes — are at least two recurring customer themes or topics identified (e.g. delivery speed, product quality, packaging)? (25 pts)
3. Verbatim examples — are direct customer quotes or sample reviews included to support findings? (20 pts)
4. Actionable recommendations — does the report suggest at least two concrete actions the business should take based on the feedback? (20 pts)
5. Volume and source — does the report state how many reviews were analyzed and from which channel(s)? (10 pts)

Return a total score out of 100. List any missing sections. Flag the report if no verbatim customer feedback is present.
```

---

### R8 — Campaign Performance Report

| Field | Value |
|-------|-------|
| Rule Name | `Campaign Performance Report` |
| Description | `Scored check that a marketing campaign report includes: campaign name, date range, key metrics (impressions/clicks/conversions), spend, ROI, and a recommendation.` |
| Rule Type | `scored` |
| Threshold | `70` |
| Weight | `2` |
| Enabled | ✅ Yes |

**Prompt Template:**
```
You are a digital marketing analyst reviewing an e-commerce campaign performance report.

Score the report from 0 to 100:

1. Campaign identification — is the campaign name/ID and the date range clearly stated? (15 pts)
2. Reach/impressions — are total impressions or reach figures included? (15 pts)
3. Engagement metrics — are clicks, CTR (click-through rate), or engagement rate included? (20 pts)
4. Conversion metrics — are conversions, sales, or revenue attributed to the campaign stated? (20 pts)
5. Budget & ROI — is the campaign spend and return on investment (or ROAS) documented? (20 pts)
6. Recommendations — is at least one recommendation or next step included based on performance? (10 pts)

Deduct 10 pts if monetary figures lack currency symbols.
Return a total score out of 100 and list any missing required sections.
```

---

### R9 — Return Policy Mention

| Field | Value |
|-------|-------|
| Rule Name | `Return Policy Mention` |
| Description | `Binary check: any document related to customer orders or refunds must reference the return or refund policy (even briefly).` |
| Rule Type | `binary` |
| Threshold | `100` |
| Weight | `1` |
| Enabled | ✅ Yes |

**Prompt Template:**
```
You are a compliance reviewer for an e-commerce business.

Check whether the submitted document contains any mention of a return policy, refund policy, exchange policy, or money-back guarantee — even a brief reference such as "subject to our returns policy" or "30-day refund window".

Answer ONLY:
- PASS — if a return or refund policy is mentioned anywhere in the document. Quote the relevant sentence.
- FAIL — if there is no mention of returns, refunds, exchanges, or money-back guarantees anywhere in the document.
```

---

### R10 — Compliance Disclaimer Present

| Field | Value |
|-------|-------|
| Rule Name | `Compliance Disclaimer Present` |
| Description | `Binary check: marketing or customer-facing documents must include a legal/compliance disclaimer or terms reference.` |
| Rule Type | `binary` |
| Threshold | `100` |
| Weight | `1` |
| Enabled | ✅ Yes |

**Prompt Template:**
```
You are a legal compliance reviewer for an e-commerce company.

Check whether the submitted document contains any form of legal disclaimer, terms and conditions reference, privacy notice, or compliance statement. This includes phrases such as:
- "Terms and conditions apply"
- "See our privacy policy at..."
- "Prices subject to change"
- "This offer is valid while stocks last"
- "© [Company Name]. All rights reserved."
- Any regulatory or legal notice

Answer ONLY:
- PASS — if at least one legal disclaimer, terms reference, or compliance statement is found. Quote it.
- FAIL — if the document contains absolutely no legal disclaimer, terms reference, or compliance statement of any kind.
```

---

## Phase 2 — Tasks

> **Where:** Dashboard → Tasks → New Task  
> **Who:** Log in as **manager**

For each task below: set the team, fill in the fields, select the listed rules in the Validation Rules section, then create.

---

### T1 — Weekly Product Catalog Update

| Field | Value |
|-------|-------|
| Title | `Weekly Product Catalog Update` |
| Description | `Submit the updated product catalog for this week. Each product entry must include the product title, SKU, price, category, and a description of at least two sentences.` |
| AI Instructions | `This is a product catalog submission. Verify that every product entry has a complete listing with all mandatory fields. Flag any product that is missing a SKU or price. Check that descriptions are not just one sentence.` |
| Deadline | Set 3 days from now |
| Allow Late | ✅ Yes |
| Late Deadline | Set 5 days from now |
| Require Late Reason | ✅ Yes |
| Rules | R1, R2, R3 |

**Test files:** `product-catalog-PASS.txt` (expected: **passed**), `product-catalog-FAIL.txt` (expected: **failed**)

---

### T2 — Daily Order Processing Report

| Field | Value |
|-------|-------|
| Title | `Daily Order Processing Report` |
| Description | `Submit today's order processing report. The report must include all order IDs processed today, customer information, order totals with currency, current status, and shipping timestamps where applicable.` |
| AI Instructions | `This is a daily order report for an e-commerce operation. Check that every order listed has an ID, a customer reference, a total with currency, and a status. Verify that all prices use the correct format ($X.XX). Flag any orders that appear to have exceeded a 48-hour fulfillment window.` |
| Deadline | Set 1 day from now |
| Allow Late | ✅ Yes |
| Late Deadline | Set 2 days from now |
| Require Late Reason | ✅ Yes |
| Rules | R4, R5, R6 |

**Test files:** `order-report-PASS.md` (expected: **passed**), `order-report-FAIL.md` (expected: **failed**)

---

### T3 — Product Photo Review

| Field | Value |
|-------|-------|
| Title | `Product Photo Review` |
| Description | `Upload the product photograph for the new Summer Collection item. The photo should clearly show the product with a white or neutral background.` |
| AI Instructions | `This submission is a product photograph. Use vision to assess: 1) Is there a visible product in the image? 2) Is the background clean/neutral? 3) Is the product well-lit? Score each 0-33 pts. Note: this is an image file — OCR may return minimal text. Focus on visual content if available.` |
| Deadline | Set 5 days from now |
| Allow Late | ❌ No |
| Rules | (leave as "All rules" — but since this is image, it will depend on AI instructions only) |

**Test file:** `product-photo-PASS.png` (expected: **needs_review** — simple PNG has minimal OCR text)

---

### T4 — Inventory Discrepancy Report

| Field | Value |
|-------|-------|
| Title | `Inventory Discrepancy Report` |
| Description | `Submit this week's inventory discrepancy report listing all SKUs where physical count does not match system count. Include the SKU, product name, expected quantity, actual quantity, and discrepancy amount.` |
| AI Instructions | `This is an inventory audit document. Verify: 1) Each line has a properly formatted SKU (uppercase letters, hyphen, digits). 2) Each entry shows expected vs actual counts. 3) The discrepancy column is calculated correctly (expected minus actual). Flag any rows with missing SKUs or uncalculated discrepancies.` |
| Deadline | Set 7 days from now |
| Allow Late | ✅ Yes |
| Late Deadline | Set 9 days from now |
| Require Late Reason | ✅ Yes |
| Rules | R1, R3, R4 |

**Test file:** `inventory-report-PASS.txt` (expected: **passed**)

---

### T5 — Monthly Customer Feedback Summary

| Field | Value |
|-------|-------|
| Title | `Monthly Customer Feedback Summary` |
| Description | `Submit the monthly customer feedback analysis report. Must include: total reviews analyzed, sentiment breakdown (positive/neutral/negative percentages), top recurring themes, direct customer quotes, and at least two actionable recommendations. A return policy reference and a compliance disclaimer are required.` |
| AI Instructions | `This is a monthly customer feedback report for our e-commerce brand. Evaluate the depth of analysis: are sentiments categorized with data? Are themes backed by customer quotes? Are recommendations specific and actionable? Check that the document references the company return policy and includes a legal disclaimer.` |
| Deadline | Set 10 days from now |
| Allow Late | ✅ Yes |
| Late Deadline | Set 14 days from now |
| Require Late Reason | ✅ Yes |
| Rules | R7, R9, R10 |

**Test files:** `customer-feedback-PASS.md` (expected: **passed**), `customer-feedback-FAIL.md` (expected: **failed**)

---

### T6 — Promotional Campaign Brief

| Field | Value |
|-------|-------|
| Title | `Promotional Campaign Brief` |
| Description | `Submit the performance brief for last month's promotional campaign. Must cover: campaign name, date range, impressions, clicks/CTR, conversions and revenue, budget spent, ROI or ROAS, and a recommendation for the next campaign. Include a legal disclaimer.` |
| AI Instructions | `This is a marketing campaign performance report. Check that all key metrics are present: reach, engagement rate, conversions, attributed revenue (with currency), budget, and ROI. Verify at least one actionable recommendation is present. Check for a compliance disclaimer at the end of the document.` |
| Deadline | Set 5 days from now |
| Allow Late | ✅ Yes |
| Late Deadline | Set 7 days from now |
| Require Late Reason | ❌ No |
| Rules | R8, R10 |

**Test files:** `campaign-brief-PASS.txt` (expected: **passed**), `campaign-brief-FAIL.txt` (expected: **failed**)

---

### T7 — Return & Refund Log (Late Submission Test)

| Field | Value |
|-------|-------|
| Title | `Return & Refund Log — Week 18` |
| Description | `Submit the weekly return and refund processing log. Each entry must include: order ID, customer reference, refund amount with currency, reason for return, and resolution status.` |
| AI Instructions | `This is a returns and refunds log. Each entry must have an order ID, customer reference, a refund amount in $X.XX format, a reason for the return, and a resolution status (Refunded/Exchanged/Rejected). Check that a return policy is referenced somewhere in the document.` |
| Deadline | **Set to 2 days AGO** (past deadline — to trigger late submission path) |
| Allow Late | ✅ Yes |
| Late Deadline | **Set to 1 day from now** |
| Require Late Reason | ✅ Yes |
| Rules | R4, R6, R9 |

**Test file:** `refund-log-PASS.txt` (expected: **late_submitted** + AI outcome **passed**)  
**Edge test:** After the late deadline also passes, try submitting → should be **blocked**.

---

### T8 — Quick Inventory Check (Edge Case)

| Field | Value |
|-------|-------|
| Title | `Quick Inventory Check` |
| Description | `Confirm receipt of the latest inventory count sheet by uploading the document.` |
| AI Instructions | `Verify that the document contains at least one product SKU in the format LETTERS-DIGITS. If the document is too short or contains only one word, mark it as failed.` |
| Deadline | Set 2 days from now |
| Allow Late | ❌ No |
| Rules | R3 |

**Test file:** `quick-check-EDGE.txt` (contents: single word `"pending"`) → expected: **failed**

---

## Phase 3 — Submissions & Expected Outcomes

> **Where:** Dashboard → My Tasks → [task name] → Submit  
> **Who:** Log in as **member**

### Submission checklist

| # | File | Task | Expected AI Outcome | Expected Status | Notes |
|---|------|------|--------------------|-----------------|----|
| S1 | `product-catalog-PASS.txt` | T1 | passed | passed | All 5 product fields + proper SKU |
| S2 | `product-catalog-FAIL.txt` | T1 | failed | failed | No SKU, no price → R3 binary FAIL |
| S3 | `order-report-PASS.md` | T2 | passed | passed | All order fields + correct price format |
| S4 | `order-report-FAIL.md` | T2 | failed | failed | Missing order totals + bad price format |
| S5 | `product-photo-PASS.png` | T3 | needs_review | needs_review | Image → minimal OCR text |
| S6 | `inventory-report-PASS.txt` | T4 | passed | passed | Full inventory with SKUs |
| S7 | `customer-feedback-PASS.md` | T5 | passed | passed | Full analysis with quotes + policy + disclaimer |
| S8 | `customer-feedback-FAIL.md` | T5 | failed | failed | No quotes, no policy, no disclaimer |
| S9 | `campaign-brief-PASS.txt` | T6 | passed | passed | All campaign metrics + disclaimer |
| S10 | `campaign-brief-FAIL.txt` | T6 | failed | failed | Metrics missing + no disclaimer |
| S11 | `refund-log-PASS.txt` | T7 | passed | late_submitted | Submit AFTER T7 deadline → late path |
| S12 | `quick-check-EDGE.txt` | T8 | failed | failed | One word: binary rule R3 FAIL |

---

## Scenario Matrix — What Each Test Validates

| Scenario | Files | What is verified |
|----------|-------|-----------------|
| Binary PASS | S1, S3, S9, S11 | `binary` rules return PASS → full weight score |
| Binary FAIL | S2, S12 | `binary` rule returns FAIL → score 0 → `failed` |
| Scored PASS (high score) | S1, S3, S6, S7, S9 | Weighted average ≥ threshold → `passed` |
| Scored FAIL (low score) | S4, S8, S10 | Weighted average < threshold → `failed` |
| Image submission | S5 | PNG → OCR extracts minimal text → `needs_review` |
| Late submission | S11 | Past deadline + `allow_late=true` → `late_submitted` |
| Single-word edge case | S12 | Shallow content → binary FAIL |
| No rules attached | Create T8 variant with `[]` rules | Pipeline skips AI → `needs_review (no_rules)` |

---

## No-Rules Edge Case (Bonus Test)

Create a **copy of T8** with the rules section expanded and **all rules unchecked** (empty selection). Submit `quick-check-EDGE.txt` to this task. Expected result: `needs_review` with flag message *"No validation rules are configured for this team..."* — this verifies the `no_rules` pipeline branch.
