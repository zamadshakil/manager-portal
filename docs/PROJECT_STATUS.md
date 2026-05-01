# Hierarchia Manager Portal — Project Status & Architecture

> Living document. Update this file whenever you ship a feature, change an
> architectural decision, or merge a major refactor. A new contributor
> should be able to read just this file plus `README.md` and orient
> themselves in under fifteen minutes.

Last reviewed: 2026-05-01 (Gemini + QStash pipeline migration)

---

## 0. TL;DR for new developers

- **Framework:** Next.js 16 (App Router), React 19, Server Actions, RSC-first.
- **Auth:** Supabase Auth (email/password). Provision-only — no public sign-up.
- **Database:** Supabase Postgres with RLS on every table.
- **Files:** Vercel Blob, fronted by an authenticated download proxy.
- **AI:** **Google Gemini** via the Vercel AI SDK (`@ai-sdk/google`) — Flash-Lite for rule evaluation and summary, Flash for vision/OCR. (No Tesseract anymore — vision-only for images.)
- **Background work:** **Upstash QStash** runs the validation pipeline as a chain of staged messages (`parse → validate_batch_N → finalize`), each its own function invocation with retry + DLQ. Vercel Cron + Upstash Redis still drive the daily missed-deadline / stuck-recovery sweep as a safety net.
- **Pipeline state / rate limit / idempotency:** Upstash Redis.
- **Roles:** `main_admin`, `manager`, `member`. Three different views of the same dashboard.

If you only remember one thing: **every mutation is a Server Action that validates with Zod, re-checks the role with `requireRole`, writes to Supabase, then `revalidatePath`s the affected routes.** Anything that bypasses that pattern is a bug.

For the full pipeline design, see [PIPELINE_ARCHITECTURE.md](./PIPELINE_ARCHITECTURE.md).

---

## 1. Product overview

Hierarchia is a portal where managers assign document-style tasks (PDF, DOCX, PPTX, images) to team members, and an AI pipeline grades each submission against (a) team-level standing rules and (b) the optional AI brief attached to that specific task. The portal handles deadlines, late submissions with reasons, missed submissions, audit logs, and per-team scoping.

| Role | What they can do |
|---|---|
| **Main Admin** | Provision users (any role, any team), create teams, post global announcements/materials, see everything across all teams. |
| **Manager** | Owns one team. Configures validation rules, creates tasks (single or bulk-assigned), reviews submissions, posts team announcements/materials. |
| **Member** | Sees their assigned tasks, uploads submissions, reads announcements, downloads materials, sees their own performance. |

Authentication is **Supabase Auth** (email + password) with **provision-only onboarding**. There is no public sign-up. Data lives in **Supabase Postgres** behind RLS. Files live in **Vercel Blob** with download proxied through a server route that re-checks RLS. The AI pipeline runs on **Google Gemini via the AI SDK** (Flash-Lite for rules/summary, Flash for vision/OCR) — orchestrated as staged messages on **Upstash QStash** so each stage gets its own function budget. Per-user/per-team rate-limiting, per-submission idempotency locks, and in-flight pipeline state all live in **Upstash Redis**.

---

## 2. High-level architecture

```
+---------------------+      +------------------------+      +----------------------+
|  Browser            |      |  Next.js 16 on Vercel  |      |  Supabase            |
|  RSC + Actions      |<---->|  (App Router)          |<---->|  Postgres + Auth     |
|  Browser SSR client |      |                        |      |  + RLS               |
+---------------------+      |  proxy.ts (middleware) |      +----------------------+
                             |  Server Actions        |
                             |  Route Handlers        |      +----------------------+
                             |  Vercel Cron entry     +----->|  Vercel Blob         |
                             |                        |      |  (random-suffix URL) |
                             |                        |      +----------------------+
                             |                        |
                             |                        |      +----------------------+
                             |                        +----->|  Upstash Redis       |
                             |                        |      |  rate limit + lock   |
                             |                        |      |  + pipeline state    |
                             |                        |      +----------------------+
                             |                        |
                             |                        |      +----------------------+
                             |                        +----->|  Google Gemini       |
                             |                        |      |  via @ai-sdk/google  |
                             |                        |      |  (rules+vision)      |
                             |                        |      +----------------------+
                             |  ^                     |
                             |  |                     |
                             |  |   /api/pipeline/run |      +----------------------+
                             |  +<-------------------------+ |  Upstash QStash      |
                             |       (signed webhook)        |  staged retries+DLQ  |
                             +-------------------------------+----------------------+
                                       ^
                                       |
                            +--------------------+
                            |  Vercel Cron daily |
                            |  Upstash gates to  |
                            |  ~15 min cadence   |
                            |  /api/cron/        |
                            |  mark-missed       |
                            +--------------------+
```

The validation pipeline never runs end-to-end inside one function. Instead the
trigger route enqueues stage 1 to QStash, and each stage publishes the next
when it finishes. See [PIPELINE_ARCHITECTURE.md](./PIPELINE_ARCHITECTURE.md)
for the full design.

### Major source areas

| Folder | Purpose |
|---|---|
| `app/(dashboard)/dashboard/` | All authenticated routes. RSC-first; the route-group layout enforces session and renders top-bar/sidebar/mobile-nav. |
| `app/auth/` | Login, OAuth callback, signout, error page. |
| `app/actions/` | Server Actions: `submissions`, `tasks`, `materials`, `announcements`, `users`, `rules`, `profile`. Each validates with Zod, re-checks role with `requireRole`, writes to Supabase, then `revalidatePath`s. |
| `app/api/` | Route handlers: `/api/download/[id]` (RLS-checked file streaming), `/api/cron/mark-missed` (scheduled job), `/api/pipeline/[id]` (trigger), `/api/pipeline/run` (QStash-signed stage handler), `/api/pipeline/failed` (QStash DLQ callback). |
| `lib/supabase/` | `client.ts` (browser SSR), `server.ts` (RSC + actions), `admin.ts` (service-role; **`server-only`**), `proxy.ts` (middleware session refresh + must-reset gate), `database.types.ts` (loose stub today; see §10 known issues). |
| `lib/llm/` | `pipeline.ts` (staged orchestrator: parse / validate_batch / finalize), `validate.ts` (Zod-typed Gemini calls + per-call timeout + retry/backoff). |
| `lib/parse/` | Format-specific parsers: PDF (`pdf-parse`), DOCX (`mammoth`), PPTX/.doc (`officeparser`). Images route to Gemini Vision via `lib/llm/validate.ts → describeImage`. |
| `lib/qstash.ts` | Publish helper + signature receiver. Falls back to inline `after()` when QStash creds are missing (dev). |
| `lib/data.ts` | All **read** queries used by RSC pages — single source of truth for query shapes. |
| `lib/auth.ts` | `requireProfile`, `requireRole`, `canManageTeam`, `getCurrentProfile`. |
| `lib/auth-shared.ts` | `roleLabel` (safe to import from client components — no `server-only` deps). |
| `lib/redis.ts` | Upstash client + `uploadLimiter()` + `llmLimiter()` (`server-only`). |
| `lib/activity.ts` | `logActivity()` — append-only audit trail (`server-only`). |
| `components/dashboard/` | All UI for the dashboard. Files are named after the page they primarily serve. |
| `components/auth/` | Sign-in form (only client-side Supabase mutation in the app). |
| `components/ui/` | shadcn/ui primitives. |
| `scripts/*.sql` | Database migrations. **Run in numeric order, top-down.** |
| `proxy.ts` | Edge proxy entry; delegates to `lib/supabase/proxy.ts`. |
| `vercel.json` | Cron schedule. |
| `next.config.mjs` | Security headers + Server Actions body limit (30 MB). |

---

## 3. Roles, RLS, and the principle of defence in depth

Authorisation is enforced **three times** in different layers:

1. **Middleware (`lib/supabase/proxy.ts`).** Every request to anything outside `/auth`, `/_next`, or `/api/auth` requires a session. If the user has `must_reset = true`, they are forced to `/dashboard/settings?reset=1` until they change their password. Public assets are matched out by the matcher in `proxy.ts`.
2. **Server Action / Route Handler.** Every mutation calls `requireProfile()` or `requireRole([...])`, then re-validates inputs with Zod, then re-checks ownership at the row level (`canManageTeam(profile, teamId)`).
3. **Postgres RLS.** Every table has RLS enabled. Helper SQL functions (`current_user_role`, `current_user_team`, `is_manager_of`, `is_main_admin`, all `SECURITY DEFINER`) live in `scripts/002_helper_functions.sql` and are also re-created in `scripts/005` as a self-heal so the order of execution stops mattering.

The **service-role client** (`lib/supabase/admin.ts`) bypasses RLS and is used only when:
- bulk-inserting `task_assignments` after the caller's manager-of-team role has already been confirmed,
- writing `validation_runs` and `activity_log` (these tables explicitly deny client writes — see §6),
- retrying a submission (queues a fresh pipeline run),
- the cron job (no user session at all).

Never import `admin.ts` from the browser — it starts with `import "server-only"` so a misuse would be caught at build time.

---

## 4. Data model

The schema is in `scripts/001_init_schema.sql`. Recent additions live in `scripts/005_tasks_and_late_submissions.sql`.

```
auth.users                                                              (Supabase managed)
   |
   v
profiles (id PK = auth.users.id)
  +- role: main_admin | manager | member
  +- team_id (FK -> teams)
  +- manager_id (FK -> profiles)
  +- must_reset (forces password change on first login)

teams                                       announcements (team_id null = global; admins only)
  +- manager_id (FK -> profiles)            materials     (team_id null = global; admins only)
  +- settings jsonb                         validation_rules (team-scoped)

submissions
  +- uploader_id, team_id
  +- blob_url, blob_pathname, mime_type, size_bytes
  +- status (queued / parsing / validating / passed / failed / needs_review
  |           / late_submitted / missed)                                 [005]
  +- score, summary, extracted_text, flags jsonb, metadata jsonb
  +- task_id              (FK -> tasks)                                  [005]
  +- task_assignment_id   (FK -> task_assignments)                       [005]
  +- is_late, late_reason, submitted_at                                  [005]
  +- timestamps

tasks                                                                    [005]
  +- team_id (FK -> teams), manager_id (FK -> profiles)
  +- title, description, instructions (sent verbatim to the LLM at submit time)
  +- due_at, allow_late, require_late_reason
  +- timestamps

task_assignments                                                         [005]
  +- task_id, assignee_id (UNIQUE together)
  +- status (assigned / submitted / late_submitted / missed)
  +- submission_id (FK -> submissions)
  +- late_reason, submitted_at
  +- timestamps

validation_runs   -- one per (submission, rule), written by service role only
activity_log      -- append-only audit trail, written by service role only
report_snapshots  -- precomputed dashboard rollups (table exists; not yet populated)
```

### Status state machines

```
submission:
  queued -> parsing -> validating -> passed | failed | needs_review

  Late path:
  queued -> parsing -> validating -> late_submitted   (preserved when is_late=true,
                                                       regardless of LLM verdict)

  Cron rescue:
  queued|parsing|validating (>30 min)  -->  failed   (with "pipeline timed out" flag)


task_assignment:
  assigned -> submitted          (member submitted on time)
  assigned -> late_submitted     (member submitted past due, with reason)
  assigned -> missed             (cron, when due passed AND allow_late=false)
```

Note the deliberate asymmetry: a late submission whose document is **rejected** by the LLM still leaves the assignment as `late_submitted` (because the member did submit something) — the rejection surfaces on the **submission** record, not the assignment row. This keeps the manager's "X / Y submitted" metric meaningful.

---

## 5. End-to-end request traces

Each row below is a verified path through the codebase as of this audit.

| User intent | Page → Action | Server-side path | Writes |
|---|---|---|---|
| Sign in | `/auth/login` | `components/auth/login-form.tsx` calls browser SSR `signInWithPassword` directly (only client-side Supabase mutation in the app — needed so cookies refresh on the SSR client) | Supabase session cookies |
| First-login password change | `/dashboard/settings?reset=1` | `app/actions/profile.ts → updatePassword` → `supabase.auth.updateUser` + clears `must_reset` via service role | `auth.users`, `profiles.must_reset` |
| Provision a user (admin) | `/dashboard/team` → `ProvisionUserForm` | `app/actions/users.ts → provisionUser` → `auth.admin.createUser` (admin client) → DB trigger `handle_new_user()` writes `profiles` → second `update` to clamp role/team_id | `auth.users`, `profiles`, `activity_log` |
| Manager creates a task | `/dashboard/tasks` → `TaskComposer` | `app/actions/tasks.ts → createTask` → Zod + `canManageTeam` → insert `tasks` (session client) → bulk insert `task_assignments` (admin client) | `tasks`, `task_assignments`, `activity_log` |
| Re-assign on an existing task | (no UI yet) | `app/actions/tasks.ts → assignTask` → `assign_task_to_team(p_task_id, p_team_id)` RPC (SECURITY DEFINER) | `task_assignments`, `activity_log` |
| Member opens a task | `/dashboard/tasks/[id]` | RSC reads via `getTaskById`, `getMyAssignmentForTask`, `listAssignmentsForTask` | none |
| Member submits to a task | `TaskSubmissionForm` on task detail | `app/actions/submissions.ts → createSubmission` (rate-limit, deadline check, blob upload, insert submission, mirror assignment, calls `/api/pipeline/[id]` which enqueues stage 1 to QStash) | `submissions`, `task_assignments`, Blob, `activity_log` |
| AI pipeline runs | (background) | QStash → `/api/pipeline/run` for each stage: `parse` (extract text or vision-OCR) → `validate_batch_N` (rules in parallel) → `finalize` (aggregate + summary + status). Each stage idempotent with Redis-backed state. DLQ to `/api/pipeline/failed`. | `submissions`, `task_assignments`, `validation_runs` |
| Manager retries a submission | submission detail → `SubmissionActions` | `app/actions/submissions.ts → retrySubmission` clears Redis state, resets status to `queued`, re-enqueues stage 1 | `submissions`, `activity_log` |
| Manager deletes a submission | submission detail → `SubmissionActions` | `app/actions/submissions.ts → deleteSubmission` deletes row + Blob | `submissions`, Blob, `activity_log` |
| Download a file | UI link `/api/download/[id]?type=...` | `app/api/download/[id]/route.ts` calls `requireProfile`, fetches row through session client (RLS), streams Blob | none |
| Mark missed / recover stuck | (cron, every 15 min) | `app/api/cron/mark-missed/route.ts` admin client query | `task_assignments`, `submissions` |
| Post announcement | `/dashboard/announcements` → `AnnouncementComposer` | `app/actions/announcements.ts → createAnnouncement` (managers can only target their own team; only admins may post `team_id IS NULL` global) | `announcements`, `activity_log` |
| Upload a material | `/dashboard/materials` → `MaterialUploader` | `app/actions/materials.ts → createMaterial` Blob upload + insert | `materials`, Blob, `activity_log` |
| Edit validation rules | `/dashboard/rules` → `RulesEditor` | `app/actions/rules.ts → upsertRule` / `deleteRule` | `validation_rules`, `activity_log` |
| Update profile | `/dashboard/settings` → `ProfileForm` | `app/actions/profile.ts → updateProfile` | `profiles`, `activity_log` |

Every action returns a discriminated `ActionResult` (`{ ok: true, … } | { ok: false, error }`) and the form reads `res.error` directly into a `role="alert"` block.

---

## 6. Critical flow deep-dives

### 6.1 First login + must-reset gate

1. Admin provisions the user with a **temporary password** and `must_reset = true` baked into `raw_user_meta_data`.
2. The DB trigger `handle_new_user()` (script 002) inserts the `profiles` row. **The first user ever created becomes `main_admin` automatically** because of the `is_first` branch in that trigger — that is how the bootstrap admin is born.
3. The user signs in. `proxy.ts` queries `profiles.must_reset` on every dashboard request and force-redirects to `/dashboard/settings?reset=1` until they change it.
4. `updatePassword` clears `must_reset` via the admin client (server-side only).

### 6.2 Manager creates and assigns a task

1. Manager opens `/dashboard/tasks`.
2. `TaskComposer` builds the form. Admins see a team picker; managers see only their own team.
3. `createTask` runs:
   1. Zod validates the form.
   2. `canManageTeam(profile, parsed.team_id)` enforces the team match.
   3. The session-bound client inserts the `tasks` row (RLS allows because the policy in 005 says `is_manager_of(team_id)`).
   4. The **admin client** is used to:
      - look up team members (when assign mode is `all`) and bulk-insert `task_assignments`,
      - or, when assign mode is `selected`, validate every supplied UUID is actually a member of the chosen team and insert only those.
   5. `logActivity('task.created')` writes to `activity_log` via service role.
4. `revalidatePath("/dashboard/tasks")` and the new task page.

### 6.3 Member submits to a task

1. Member opens `/dashboard/tasks/[id]`. The page renders `TaskSubmissionForm` only for the assignee.
2. The form computes overdue state **client-side** for instant UX:
   - On time → upload normally.
   - Overdue + `allow_late=true` → late-reason field appears (≥ 8 chars if `require_late_reason`).
   - Overdue + `allow_late=false` → button disabled and the form refuses to send.
3. `createSubmission` is the source of truth — never trust the client:
   1. File type + size validated against `ACCEPTED_MIME_TYPES` and `MAX_FILE_SIZE_BYTES = 25 MB`.
   2. Per-user upload rate-limit (`uploadLimiter`: 20 / 10 min).
   3. Loads the task, the assignment, and re-applies the deadline rules. Refuses if the assignment is already in a non-`assigned` state.
   4. Uploads to Vercel Blob with `addRandomSuffix: true`. The URL is unguessable; the client never receives it directly — they go through `/api/download/[id]?type=submission`.
   5. Inserts the `submissions` row with `task_id`, `task_assignment_id`, `is_late`, `late_reason`, `submitted_at`.
   6. **Eagerly mirrors** the matching `task_assignment` to `submitted` / `late_submitted` so manager dashboards reflect status without waiting for the pipeline.
   7. `after(processSubmission(id))` schedules the AI pipeline.
4. `revalidatePath` for the dashboard, submissions list, the task list, and the specific task detail page.

### 6.4 AI validation pipeline — staged via Upstash QStash

The pipeline runs as a chain of independent function invocations, each
delivered by QStash as a signed webhook. **No single function ever runs
the whole pipeline.** This is what makes large submissions reliable on the
Hobby plan's 60s ceiling.

The full design lives in [PIPELINE_ARCHITECTURE.md](./PIPELINE_ARCHITECTURE.md).
The condensed version:

1. **Trigger** — `createSubmission` (or `retrySubmission`) inserts the row,
   calls `/api/pipeline/[id]` which calls `enqueueSubmission()` and returns
   immediately. `enqueueSubmission` publishes `stage=parse` to QStash with
   an idempotency key of `{submissionId}:parse:0`.
2. **Stage `parse`** — fetch the blob, extract text (PDF/DOCX/PPTX) or run
   **Gemini Vision** via `describeImage` (images), clamp to 60 KB,
   persist to `submissions.extracted_text` + Redis state under
   `pipeline:state:{submissionId}`. Publish `stage=validate_batch_0`.
3. **Stage `validate_batch_N`** — load extracted text + rules from Redis,
   run up to 8 rules in parallel (`LLM_RULE_CONCURRENCY`) against
   **Gemini Flash-Lite**, with a 20 s per-call abort timeout and at most
   2 retries (no retry on permanent errors). Insert `validation_runs`
   for the real rules (synthetic `task:{taskId}` rules are filtered out —
   they have no FK target). Append outcomes to Redis. Publish next
   batch or `stage=finalize`.
4. **Stage `finalize`** — load all per-rule outcomes, compute weighted
   average, run summary call, decide final status. **Late preserves
   late:** if `submission.is_late=true` the final status is forced to
   `late_submitted` regardless of LLM verdict. Mirror the matching
   `task_assignment` row. Delete Redis state.
5. **Failure** — if any stage's retries exhaust, QStash POSTs to
   `/api/pipeline/failed` which marks the submission `failed` with the
   underlying error preserved. **A submission can never get permanently
   stuck in a non-terminal state.**
6. **Rate limit + idempotency** — `llmLimiter` (60/min per team) gates
   each LLM call; the QStash deduplication header on every publish
   prevents duplicate stage runs even under retry storms.

### 6.5 Cron — missed deadlines and stuck-pipeline recovery

**Scheduling Strategy:** Since Vercel Cron allows only **one job per day**, we use **Upstash Redis** to maintain 15-minute execution intervals. The `vercel.json` entry calls `/api/cron/mark-missed` once daily (`0 0 * * *`), but the handler uses `shouldRunCronTask()` from `lib/upstash-scheduler.ts` to gate execution — it only runs if 15 minutes have elapsed since the last execution, stored in Redis.

The handler is protected by `Authorization: Bearer ${CRON_SECRET}` (see §8). It runs two queries via the admin client:

1. **Mark missed.** `task_assignments.status = 'assigned'` join `tasks` where `due_at < now()` AND `tasks.allow_late = false` → flip to `missed`.
2. **Recover stuck.** Any `submissions.status IN ('queued','parsing','validating')` whose `updated_at` is older than 30 minutes → flip to `failed` with a `"Validation pipeline timed out. Please retry."` flag. This is the **belt-and-suspenders** failsafe — QStash already retries each stage and routes exhausted retries to `/api/pipeline/failed`, so anything reaching the 30-minute threshold means Redis state expired before the next stage fired (very rare).

The endpoint returns `{ ok, missedCount, stuckRecovered, skipped }` so it's easy to verify with curl. Executions are logged in `cron:mark-missed:executions` in Redis for monitoring.

**Key modules:**
- `lib/upstash-scheduler.ts` — `shouldRunCronTask()`, `recordTaskExecution()`
- `app/api/cron/scheduled-init/route.ts` — (optional) manual initialization endpoint
- `app/api/cron/mark-missed/route.ts` — main cron handler with Upstash gating

### 6.6 Authenticated download proxy

`/api/download/[id]?type=submission|material` runs `requireProfile()` first (which forces auth + must-reset gate via the proxy chain), then reads the row through the **session-bound** Supabase client so RLS enforces visibility. Once the row is resolved, the route fetches the unguessable Blob URL on the server and streams the bytes back with a sensible `Content-Disposition`. The Blob URL never crosses the network to the client.

---

## 7. Module dependency matrix

| Module | Imports from | Imported by | Server-only? |
|---|---|---|---|
| `lib/upstash-scheduler.ts` | `@upstash/redis` | `app/api/cron/mark-missed`, monitoring tools | yes |
| `lib/supabase/admin.ts` | `@supabase/supabase-js` | `app/actions/*`, `lib/llm/pipeline.ts`, `lib/activity.ts`, `app/api/cron/*` | yes |
| `lib/supabase/server.ts` | `@supabase/ssr`, `next/headers` | RSC pages, `lib/auth.ts`, `lib/data.ts`, action handlers | no (RSC compatible) |
| `lib/supabase/client.ts` | `@supabase/ssr` | `components/auth/login-form.tsx` | no (browser) |
| `lib/supabase/proxy.ts` | `@supabase/ssr`, `next/server` | `proxy.ts` (edge) | edge runtime |
| `lib/auth.ts` | `lib/supabase/server.ts`, `next/navigation` | every dashboard page + every action | no |
| `lib/auth-shared.ts` | `lib/types.ts` | client components (sidebar/top-bar/etc) | no — safe for client |
| `lib/data.ts` | `lib/supabase/server.ts`, `lib/types.ts` | RSC pages only | no |
| `lib/activity.ts` | `lib/supabase/admin.ts`, `next/headers` | every action | yes |
| `lib/redis.ts` | `@upstash/redis`, `@upstash/ratelimit` | `lib/llm/pipeline.ts`, `app/actions/submissions.ts`, `lib/qstash.ts` | yes |
| `lib/qstash.ts` | `@upstash/qstash` | `app/api/pipeline/*`, `lib/llm/pipeline.ts` | yes |
| `lib/llm/pipeline.ts` | `lib/supabase/admin.ts`, `lib/parse`, `lib/llm/validate.ts`, `lib/redis.ts`, `lib/qstash.ts` | `app/actions/submissions.ts`, `app/api/pipeline/[id]`, `app/api/pipeline/run` | yes |
| `lib/llm/validate.ts` | `ai`, `@ai-sdk/google`, `zod` | `lib/llm/pipeline.ts` | yes |
| `lib/parse/index.ts` | `pdf-parse`, `mammoth`, `officeparser` | `lib/llm/pipeline.ts` | yes |

The "yes" rows all start their files with `import "server-only"` so the bundler hard-fails on accidental client imports.

---

## 8. Environment variables

These must be set on Vercel (Production + Preview). Locally they go in `.env.local` which is git-ignored.

| Variable | Required by | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | from Supabase project settings |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | RLS-bound public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | RLS bypass — keep secret |
| `BLOB_READ_WRITE_TOKEN` | server only | Vercel Blob (auto-injected on Vercel) |
| `UPSTASH_REDIS_REST_URL` | server only | rate limit + idempotency + pipeline state |
| `UPSTASH_REDIS_REST_TOKEN` | server only | as above |
| `QSTASH_TOKEN` | server only | publishes pipeline stage messages |
| `QSTASH_CURRENT_SIGNING_KEY` | server only | verifies inbound `/api/pipeline/run` webhooks |
| `QSTASH_NEXT_SIGNING_KEY` | server only | webhook verification during key rotation |
| `APP_URL` | server only | base URL QStash delivers webhooks to (falls back to `https://${VERCEL_URL}` on previews) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | server only | read by `@ai-sdk/google` automatically |
| `GEMINI_VALIDATION_MODEL` | optional | defaults to `gemini-flash-lite-latest` |
| `GEMINI_SUMMARY_MODEL` | optional | defaults to `gemini-flash-lite-latest` |
| `GEMINI_VISION_MODEL` | optional | defaults to `gemini-flash-latest` |
| `LLM_CALL_TIMEOUT_MS` | optional | per-call abort timeout, default 20000 |
| `LLM_RULE_CONCURRENCY` | optional | parallel rules per batch, default 8 |
| `PIPELINE_BUDGET_MS` | optional | function-level abort budget, default 50000 |
| `CRON_SECRET` | server only | shared secret for the cron endpoint — see below |

In dev, omitting `QSTASH_*` is fine — `lib/qstash.ts` falls back to inline `after()` execution. **In production all four QStash variables (`QSTASH_TOKEN`, both signing keys, and `APP_URL`) must be set** or the pipeline downgrades to a single function and can hit the 60 s wall-clock ceiling.

### About `CRON_SECRET` and `UPSTASH_REDIS_*`

**CRON_SECRET:** A random opaque token **you generate yourself**. There is no service that issues it. Generate one with:

```bash
openssl rand -hex 32
```

Add `CRON_SECRET = <value>` to *Vercel → Project → Settings → Environment Variables* for Production (and Preview if you want preview crons to fire). When Vercel Cron triggers `/api/cron/mark-missed`, it sends `Authorization: Bearer ${CRON_SECRET}` automatically. The route checks:

```ts
const auth = request.headers.get("authorization")
if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 })
}
```

If the variable is **unset**, the check is skipped — intentional for local dev so `curl http://localhost:3000/api/cron/mark-missed` works without ceremony. **Always set it on Vercel** — otherwise anyone can trigger the job.

**UPSTASH_REDIS_REST_URL & UPSTASH_REDIS_REST_TOKEN:** Required for 15-minute interval scheduling (via `lib/upstash-scheduler.ts`). These are auto-injected by Vercel if you've connected the Upstash integration, but can also be manually added. The cron handler uses Redis to gate execution, ensuring the task only runs once per 15 minutes despite Vercel calling it daily.

Manual test:

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-deployment>.vercel.app/api/cron/mark-missed
```

---

## 9. Migrations

Apply SQL files from `scripts/` in the Supabase **SQL Editor** (Project → SQL → New query → paste → Run). They are idempotent — safe to re-run.

```
scripts/001_init_schema.sql                 -- tables, enums, indexes
scripts/002_helper_functions.sql            -- current_user_role, etc + handle_new_user trigger
scripts/003_rls_policies.sql                -- enable RLS + policies on the original tables
scripts/004_seed_demo_data.sql              -- optional demo content
scripts/005_tasks_and_late_submissions.sql  -- tasks / assignments / late columns / RLS hardening
```

If you only want the latest changes on top of an existing database, **running 005 alone is safe**: it re-creates any missing helpers (`current_user_role`, `current_user_team`, `is_manager_of`, `is_main_admin`, `touch_updated_at`) and skips anything that already exists.

### Common migration gotchas

- `ALTER TYPE … ADD VALUE` cannot run inside a transaction or `DO $$ … $$` block in Postgres. Script 005 keeps those statements at the top level with `IF NOT EXISTS`.
- The Supabase SQL editor wraps your pasted snippet in a transaction, so if you ever need to add new enum values **interactively**, run those single statements first, then run the rest of the migration.
- `CREATE POLICY IF NOT EXISTS` doesn't exist — always `DROP POLICY IF EXISTS … CREATE POLICY …`. We do this everywhere already.

---

## 10. Status — done vs. in-flight

### Shipped

- Supabase auth with provision-only onboarding + forced password-reset gate
- Three-role RBAC (main_admin / manager / member) enforced at RLS + middleware + server actions
- **Tasks system end-to-end:** create, single/bulk assign, member submission, late-with-reason, missed via cron, manager assignment table on the task detail page
- Submissions: upload, AI validation, retry, delete
- Native parsers for PDF / DOCX / PPTX; Gemini Vision for images
- **Staged AI pipeline on Upstash QStash:** `parse → validate_batch_N → finalize`, each its own function with retry + DLQ. Replaced the previous Groq-in-after() pipeline. See [PIPELINE_ARCHITECTURE.md](./PIPELINE_ARCHITECTURE.md).
- LLM pipeline with idempotency lock, per-call timeout + bounded retry, structured output via Zod, weighted aggregate
- Per-team validation rules CRUD with `{{TEXT}}` placeholder substitution
- Announcements + materials (team-scoped, `expires_at` filtering for announcements)
- Activity log (append-only audit trail; explicit RLS deny on client writes)
- Reports page with daily metrics chart (90-day window)
- Notion-inspired design tokens + Inter / JetBrains Mono fonts
- Security headers (HSTS, X-Frame-Options DENY, Permissions-Policy), 30 MB Server-Action body limit, generic login error messages
- AlertDialog replacing all `confirm()` / `alert()` calls
- Loading + error boundaries on the dashboard route group
- Mobile bottom nav with safe-area padding
- Authenticated download proxy at `/api/download/[id]`
- Cron route to mark missed assignments + recover stuck submissions

### In flight / TODO (priority order)

- **Manager UI to call `assignTask`**. The server action is implemented and the SQL RPC `assign_task_to_team` is granted to `authenticated`, but no button surfaces it yet. Useful when new members join after a task was created.
- **Realtime status on submission detail.** Subscribe to a Supabase channel so members see `queued → validating → passed` without refreshing.
- **Daily cron rollup of `report_snapshots`.** Reports currently compute from raw `submissions`; precompute to cut DB load.
- **Redis cache on `getDailyMetrics`** (60s TTL) for hot dashboard reads.
- **Read receipts on announcements** — track who has acknowledged.
- **PDF report export** via `@react-pdf/renderer` (CSV is shipped already).
- **CSV streaming export of activity log** for compliance audits.
- **Sentry integration** — server + client (Sentry MCP is available).
- **Generate full database types** from the Supabase CLI to replace the loose `Database = any` shim in `lib/supabase/database.types.ts`.
- **Pagination UX on submissions table** — cursor pagination is implemented in `lib/data.ts → listSubmissions`, but the list page does not yet wire it through `searchParams`.
- **Tests** — Playwright happy-paths + unit tests for the AI pipeline with a mocked Gemini provider and a fake QStash receiver.

### Known small mismatches surfaced by this audit

- `app/actions/users.ts → provisionUser` `revalidatePath`s `/dashboard/admin/users`, but no such route exists today. Harmless, just a leftover from an earlier sketch. Remove or implement.
- The `assign_task_to_team` RPC is granted to `authenticated` but only the server action calls it (via the admin client which bypasses RLS anyway). The grant is harmless — it just means a future client-side caller would also be allowed if and when we wire one up.
- The cron endpoint overwrites `submissions.flags` with the timeout flag rather than appending. That's acceptable today (the only path that triggers it is a stuck pipeline that hasn't written flags yet) but worth keeping in mind if we ever expand its behaviour.

---

## 11. Local dev checklist

```bash
pnpm install
cp .env.local.example .env.local        # fill in your own values
# (Supabase) run scripts/001..005 in the SQL editor, in order
pnpm dev
```

- The first user you create in Supabase becomes `main_admin` automatically (via the `is_first` branch in `handle_new_user()`).
- Watch the v0/Vercel server logs for `[v0]`, `[pipeline]`, `[submissions]`, and `[activity]` lines while testing the upload flow.
- The cron endpoint can be hit locally with the curl snippet in §8. With `CRON_SECRET` unset locally it returns 200 to any caller, which is fine for dev.

---

## 12. Conventions worth keeping

- **RSC by default; Server Actions for every mutation.** The only client-side Supabase mutation is `signInWithPassword` in the login form — required so the SSR client's cookies refresh on the same response.
- **Every action returns a discriminated `ActionResult`** (`{ ok: true, ... } | { ok: false, error }`). Forms read `res.error` directly into a `role="alert"` block.
- **Server-only modules MUST start with `import "server-only"`.** Already applied to `admin.ts`, `redis.ts`, `activity.ts`, `pipeline.ts`, `validate.ts`, `parse/index.ts`. Any new module under `lib/` that touches service-role secrets, Redis, Blob, or Tesseract should follow.
- **Never use `localStorage` for persistence.** All state lives in Supabase.
- **Use design tokens, not hex codes.** `bg-primary`, `text-foreground`, `bg-muted`, etc., defined in `app/globals.css`. The brand primary `#0075de` and the soft accent `#f2f9ff` are wired through tokens; reach for tokens first.
- **Error messages are user-friendly.** "Submission failed: deadline has passed and late submissions are not allowed" — never "FK constraint violated".
- **Always add a Zod schema** at the top of an action file; never trust formData fields. Coerce booleans with `z.coerce.boolean()` and dates by transforming the string yourself (see `tasks.ts → CreateTaskSchema.due_at`).
- **Always re-check ownership on the server**, even if the UI already hid the button. The download proxy is the canonical example: it doesn't trust the URL, it re-reads the row through RLS.
- **Always `revalidatePath`** every page that could now show different data, including the source page so the form gets fresh data on next render.
