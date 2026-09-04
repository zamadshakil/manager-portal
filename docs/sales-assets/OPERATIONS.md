# Hierarchia Sales Funnel Operations Handoff

ZamDev AI | 5 September 2026 | Owner Zamad | Recipient sales and implementation operator

The sales showcase and audit-request intake are live at [showcase.zamdevai.com](https://showcase.zamdevai.com). Use this handoff to qualify inquiries, demonstrate the workflow and sell a separately scoped deployment. The immediate job is to review incoming requests and prepare owner-approved conversations. Email templates are saved but inactive; no outreach or LinkedIn content has been sent.

This is the current operational companion to the earlier Sales Funnel Implementation Plan. It supersedes that plan's Vercel hosting assumptions, launch status and suggestion to use Brevo for cold outreach. No paid upgrade was made. Cloudflare hosts the site under the existing account and domain; the existing system and Vercel DNS records were left unchanged.

## What is live

The landing page explains the offer and links to three use-case pages, a workload calculator, a downloadable workflow worksheet and an audit-request form. The form saves validated requests to the dedicated Brevo audit list. It requires acknowledgment of the privacy notice and offers a separate, unchecked marketing preference. A successful submission does not book an appointment, start a subscription or send an email.

Share [the guest selector](https://showcase.zamdevai.com/auth/login/) to let someone explore manager and team-member views without credentials. The views use synthetic, browser-local records. Manager decisions and member resubmission are simulated; refresh or reset restores sample state. This is not the full application or evidence that its AI, authentication, storage or messaging integrations are running.

The original dashboard still needs an isolated backend and end-to-end verification. The previously observed Supabase free-project limit prevented a separate showcase database. Do not attach the preview to an existing live database to bypass that limit.

## Customers and positioning

Start with agencies and outsourced service teams with roughly 15 to 150 people, recurring document or content deliverables, and at least 50 submissions a week. These ranges are prospecting hypotheses, not proven product-market fit. The buyer is usually a founder, operations leader or delivery manager; the working champion owns the review queue. Look for repeated returns, inconsistent checks and managers reconstructing context across chat and documents.

Ecommerce operations are a secondary segment when teams repeatedly review product content, catalog changes or operational reports. Training operations are another secondary segment when lesson material or internal deliverables require repeatable checks. Test each segment separately; do not mix their replies into one conversion claim.

Suggested pitch: Hierarchia brings task briefs, standing rules and submission review into a role-aware workflow. We help your team define the checks, keep final decisions with your reviewers, and test the workflow in a small custom deployment. The first step is a free 20-minute workflow audit; a paid pilot is quoted separately.

Disqualify teams without a recurring review process, a responsible reviewer or permission to use representative data. Escalate regulated or sensitive workflows for a separate assessment. Do not promise autonomous acceptance, a compliance certification, particular integrations, guaranteed savings or deployment features that have not been verified.

## The three funnel paths

For founder-led LinkedIn, publish an approved practical post, respond manually to relevant comments, and offer the worksheet or audit when there is interest. Use the matching agency, ecommerce or training page to explain the context. Do not scrape profiles, automate connections or send bulk direct messages.

For an inbound audit, review the saved request, confirm fit and offer two specific meeting times with a timezone. Send a calendar invitation only after the person accepts a slot. Run the audit, demonstrate the matching sample workflow and agree whether a separately priced pilot is worth scoping.

For requested email updates, confirm permission before adding the contact to nurture. The five saved templates cover the workflow map, baseline, human decisions, pilot scope and closing the loop. The proposed timing is day 0, 3, 6, 10 and 14 after enrollment. There is no active scheduler today; do not imply the sequence already runs.

Use direct audit links when attributing a campaign. For example, append ?utm_source=linkedin&utm_medium=organic&utm_campaign=agency_workflow_sep2026 to the audit URL. The form records query parameters present on that page at submission. It does not preserve first-touch attribution through every navigation, and no advertising pixel or visitor analytics dashboard is installed.

## Brevo operating instructions

Sign in to the existing ZamDev AI Brevo account using the owner's approved access. The Hierarchia sales folder is ID 16. Its lists are Audit requests 17, Opt-in nurture 18, Qualified pilots 19, Customers 20 and Do not contact 21. Existing unrelated lists, campaigns and contacts were not imported or reorganized.

Every business day, open list 17 and examine the newest HIER_REQUESTED_AT values. Assign HIER_OWNER, HIER_STAGE, HIER_NEXT_STEP and HIER_NEXT_STEP_DATE before responding. Use these stage values consistently: New, Reviewing, Audit scheduled, Audit complete, Pilot proposed, Pilot active, Customer, Closed lost or Suppressed. These are contact attributes, not an active deal pipeline.

Read HIER_COMPANY, HIER_ICP, HIER_TEAM_SIZE, HIER_VOLUME, HIER_WORKFLOW and HIER_PREFERRED_TIME before writing. HIER_SCORE is a rule-based fit score, not purchase intent or an AI assessment. A score of 70 or above can be triaged first, but a human must verify the workflow and authority. Source, medium and campaign are recorded in their corresponding HIER attributes.

Public intake adds only list 17. HIER_MARKETING_REQUESTED records the checkbox preference, not a completed confirmation. Do not move someone into list 18 solely because they asked for an audit. Confirm consent and its evidence first, then set HIER_CONSENT_CONFIRMED. Existing lifecycle, global identity and blocklist settings are not overwritten by intake.

Before every follow-up, check the provider blocklist, list 21 and HIER_STOP_FOLLOWUP. A direct opt-out must stop relevant messages, remove nurture membership, set HIER_STOP_FOLLOWUP to true and HIER_STAGE to Suppressed, and add list 21. List 21 alone does not automatically suppress sending; the operator and any future automation must enforce these exclusions.

## Email activation gate

Templates 13 through 17 are saved as inactive nurture drafts. The authenticated sender is mail@zamdevai.com with display name Zamad at ZamDev AI and replies directed to that address. The personal Gmail is an account administrator identity, not the planned campaign From address.

The owner has requested hirarchia@zamdevai.com as the funnel email address. It is not currently listed as an active Brevo sender, and its receiving mailbox has not been verified. Confirm the spelling, provision or verify receiving access, then verify the sender before replacing the working address. This email address does not replace the physical business mailing address needed for the footer.

Before activation, obtain the owner-approved business mailing address, add it to every footer, verify sender and domain status, and review the final copy. Test the opt-in confirmation and unsubscribe flow with owned test addresses. Record the confirmation time and source, verify suppression and stop-on-reply behavior, and exclude existing customers and active pilots where the content is no longer relevant. Keep templates inactive until these checks pass.

The native automation workflow has not been created. Configure one only after confirming the existing plan supports the required triggers and exclusions without an upgrade. If it does not, use a reviewed manual send process to confirmed opt-ins or ask the owner to choose an alternative. Do not accept a trial or upgrade on their behalf.

Do not upload purchased, scraped or cold prospect lists to Brevo. Permission-based nurture and replies to requested audits are different workflows. Any cold outreach program needs separate owner approval, provider-policy review and a jurisdiction-specific compliance check. The earlier plan's cold-email instruction must not be used as launch authority.

## Discovery and pilot conversion

Use the first five minutes to establish the deliverable, reviewer, submission volume and recurring failure. In the next five minutes, map who supplies inputs, where standing rules live, what the task brief adds and what makes a submission acceptable. Ask for an anonymized example rather than confidential files. Then show the corresponding sample journey and reserve the final five minutes for fit and next steps.

Record the baseline over a typical week: number of submissions, minutes spent on review and number of returned submissions. The calculator is an illustrative estimate. Its repeat-review estimate assumes one extra review of the same length; its suggested reduction is hypothetical. Do not present the result as an observed saving.

For a qualified pilot, agree one team, no more than two workflows, reviewer responsibilities, data handling, access, integrations, deployment ownership and acceptance criteria. Use the separate proposal template. Zamad approves the price, payment schedule, scope and delivery date; none was set during funnel setup.

A suggested 30-day pilot begins with workflow mapping and a measured baseline, then a small configuration and test phase, followed by supervised use and an end-of-pilot review. These are planning stages, not a delivery guarantee. Compare review time, return rate and reviewer agreement using the same definitions before and after. Obtain permission before using customer names, screenshots or results as case studies.

## Operator launch checklist

First, review the live site and sample personas with Zamad, learn the CRM fields and choose the named sales owner. Confirm who reads mail@zamdevai.com and how often. Run a scheduling exchange with an owned address and confirm that replies arrive. The live intake test already verified persistence and marketing opt-out, but mailbox delivery and calendar booking were not tested.

Next, research 25 candidate accounts from their own public websites and manual profile review. Record company URL, segment, size evidence, recurring workflow evidence, source date, likely buyer role and disqualifiers. Do not guess personal emails or treat a publicly listed address as marketing consent. No researched account batch or 20 genuinely personalized prospect messages has been completed in this release.

Use the supplied LinkedIn and response drafts to prepare the first three posts and the first relevant one-to-one conversations. Replace all placeholders, substantiate every observation and obtain Zamad's approval. Publish and send manually. The initial goal is to learn which workflow generates qualified conversations, not to maximize message volume.

Review the funnel weekly: unique inquiries, qualified inquiries, audits scheduled, audits held, proposals and pilots won. Calculate each conversion with its actual denominator and report counts alongside percentages. Exclude internal QA and duplicates; separate inbound requests from cold prospect research. With no visitor analytics, do not report a visitor-to-lead conversion rate. The weekly review is an operator responsibility, not a scheduled automation.

## Technical ownership and verification

The private source repository is [manager-portal](https://github.com/zamadshakil/manager-portal), on branch preview/showcase-guest-access-20260904. The Cloudflare Worker is hierarchia-showcase. Its static assets are built from showcase-site and shared showcase components; the form API alone runs in the Worker. Existing application routes and Supabase secrets are not part of this deployment.

Verification passed for the original application build, the static showcase build, type checks, ten funnel unit tests and a production dependency audit with no known advisories. The repository still has 408 legacy lint warnings. Live HTTP checks covered the landing page, both sample roles, the three use cases, calculator, worksheet, privacy notice and form. An owned-address QA request reached the correct Brevo list and was then removed; no email was sent. Browser visual and interaction QA remains a human launch check.

The form enforces trusted origins, validation, an 8 KiB request cap, a honeypot and a Cloudflare per-location limit of six requests per minute per IP. It fails visibly if persistence fails. These are basic abuse controls, not a guarantee against bots. If spam or provider errors grow, pause intake and investigate before adding a paid tool or stronger challenge.

Use TECHNICAL-RUNBOOK.md for builds, deployment, secret rotation and rollback. The Brevo API key is a Cloudflare secret and is not in source control. A protected local environment file remains for the owner. A GitHub quality workflow and Dependabot configuration were added; main-branch protection and full authentication, RLS and migration test coverage remain separate production-readiness work.

The showcase is intentionally marked noindex for preview use. Before a broader public launch, agree indexing, retention, privacy wording, consent, mailbox handling and the full deployment scope. No production customer data should be added to this sample experience.
