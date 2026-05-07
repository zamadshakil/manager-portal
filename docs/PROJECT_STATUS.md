# Hierarchia Manager Portal — Project Status & Architecture

> Living document. Update this file whenever you ship a feature, change an
> architectural decision, or merge a major refactor. A new contributor
> should be able to read just this file plus `README.md` and orient
> themselves in under fifteen minutes.

Last reviewed: 2026-05-07 (full architecture + documentation audit) 

---

## 0. TL;DR for new developers

- **Framework:** Next.js 16 (App Router), React 19, Server Actions, RSC-first.
- **Auth:** Supabase Auth via self-hosted GoTrue on Railway (email/password). Provision-only — no public sign-up.
- **Database:** Self-hosted Supabase Postgres on Railway with RLS on every table + pgvector for RAG.
- **Files:** Cloudflare R2 (S3-compatible), fronted by an authenticated download proxy.
- **AI — Validation:** OpenRouter → Gemini 2.0 Flash (via Vercel AI SDK v6) for validation + summarisation + vision OCR.
- **AI — Smart AI Chat:** OpenRouter → GPT-4o-mini (configurable) with native tool-calling + RAG retrieval (pgvector + BM25).
- **Background work:** In-process async pipeline for AI validation + Railway HTTP cron (every 15 min) for missed-deadline sweeps, stuck-submission recovery, and expiration cleanup.
- **Rate limit / idempotency:** Upstash Redis.
- **Email:** Brevo (transactional welcome emails on user provisioning).
- **Deployment:** Railway (portal + self-hosted Supabase stack in a single project).
- **Roles:** `main_admin`, `manager`, `member`. Three different views of the same dashboard.

If you only remember one thing: **every mutation is a Server Action that validates with Zod, re-checks the role with `requireRole`, writes to Supabase, then `revalidatePath`s the affected routes.** Anything that bypasses that pattern is a bug.

---

## 1. Product overview

Hierarchia is a portal where managers assign document-style tasks (PDF, DOCX, PPTX, images) to team members, and an AI pipeline grades each submission against (a) team-level standing rules and (b) the optional AI brief attached to that specific task. The portal handles deadlines, late submissions with reasons, missed submissions, audit logs, and per-team scoping.

| Role | What they can do |
|---|---|
| **Main Admin** | Provision users (any role, any team), create teams, post global announcements/materials, see everything across all teams. |
| **Manager** | Owns one team. Configures validation rules, creates tasks (single or bulk-assigned), reviews submissions, posts team announcements/materials. |
| **Member** | Sees their assigned tasks, uploads submissions, reads announcements, downloads materials, sees their own performance. |

Authentication is **Supabase Auth** (self-hosted GoTrue on Railway, email + password) with **provision-only onboarding**. There is no public sign-up. Data lives in **self-hosted Supabase Postgres** behind RLS. Files live in **Cloudflare R2** with download proxied through a server route that re-checks RLS. The AI validation pipeline runs on **OpenRouter (Gemini 2.0 Flash)** via Vercel AI SDK v6, with native Gemini Vision for OCR. The **Smart AI** conversational assistant uses OpenRouter with tool-calling and native pgvector RAG retrieval. Per-user/per-team rate-limiting and per-submission idempotency live in **Upstash Redis**. AI usage is tracked via a per-user **credit system** with configurable periods.

---

## 2. High-level architecture

```
+---------------------+      +---------------------------+      +--------------------------+
|  Browser            |      |  Next.js 16 on Railway    |      |  Self-hosted Supabase    |
|  RSC + Actions      |<---->|  (App Router, standalone) |<---->|  Postgres + pgvector    |
|  Browser SSR client |      |                           |      |  + GoTrue Auth + RLS    |
+---------------------+      |  proxy.ts (middleware)    |      |  (via Kong gateway)     |
                             |  Server Actions           |      +--------------------------+
                             |  Route Handlers           |
                             |  Async pipeline runner    |      +--------------------------+
                             |                           +----->|  Cloudflare R2          |
                             |                           |      |  (S3-compatible files)  |
                             |                           |      +--------------------------+
                             |                           |
                             |                           |      +--------------------------+
                             |                           +----->|  Upstash Redis          |
                             |                           |      |  rate limit + cron gate |
                             |                           |      +--------------------------+
                             |                           |
                             |                           |      +--------------------------+
                             |                           +----->|  OpenRouter → Gemini    |
                             |                           |      |  via AI SDK v6          |
                             +---------------------------+      +--------------------------+
                                       ^
                                       |
                             +--------------------+
                             |  Railway HTTP Cron |
                             |  every 15 minutes  |
                             |  mark-missed +     |
                             |  expire + recover  |
                             +--------------------+
```

### Major source areas

| Folder | Purpose |
|---|---|
| `app/(dashboard)/dashboard/` | All authenticated routes. RSC-first; the route-group layout enforces session and renders top-bar/sidebar/mobile-nav. |
| `app/auth/` | Login, forgot-password, update-password, OAuth callback, signout, error page. |
| `app/actions/` | Server Actions: `submissions`, `tasks`, `materials`, `announcements`, `departments`, `users`, `rules`, `profile`, `ai-credits`. Each validates with Zod, re-checks role with `requireRole`, writes to Supabase, then `revalidatePath`s. |
| `app/api/smart-ai/` | Smart AI endpoints: `chat` (streaming), `upload` (R2 + RAG indexing), `threads` (history), `analytics`, `health`. |
| `app/api/cron/` | Railway cron endpoint for scheduled background jobs (mark-missed, expire content, recover stuck). |
| `app/api/` | Route handlers: `/api/download/[id]` (RLS-checked file streaming), `/api/ai-credits/me`, `/api/vitals`. |
| `lib/supabase/` | `client.ts` (browser SSR), `server.ts` (RSC + actions), `admin.ts` (service-role; **`server-only`**), `proxy.ts` (middleware session refresh + must-reset gate), `database.types.ts` (loose stub). |
| `lib/llm/` | `pipeline.ts` (orchestrator), `validate.ts` (Zod-typed OpenRouter/Gemini calls + retry/backoff). |
| `lib/parse/` | Format-specific parsers: PDF (`unpdf` + `@napi-rs/canvas` OCR fallback), DOCX (`mammoth`), PPTX/XLS/.doc (`officeparser`), images (Gemini Vision), text/markdown (passthrough). |
| `lib/smart-ai/` | `indexer.ts` (pgvector document indexing), `retriever.ts` (hybrid vector+BM25 retrieval via RPC), `client.ts` (MCP client), `sliding-window.ts` (token management). |
| `lib/pipeline/` | `process.ts` (in-process async AI validation pipeline with built-in crash recovery). |
| `lib/data.ts` | All **read** queries used by RSC pages — single source of truth for query shapes. |
| `lib/auth.ts` | `requireProfile`, `requireRole`, `canManageTeam`, `getCurrentProfile`. |
| `lib/auth-shared.ts` | `roleLabel` (safe to import from client components — no `server-only` deps). |
| `lib/r2.ts` | Cloudflare R2 client (`put`, `del`, `head`, `get`) via `@aws-sdk/client-s3`. |
| `lib/redis.ts` | Upstash client + `uploadLimiter()` + `llmLimiter()` + `chatLimiter()` (`server-only`). |
| `lib/email.ts` | Brevo transactional email integration (welcome emails). |
| `lib/env.ts` | Centralized env-var validation with Railway migration notes. |
| `lib/activity.ts` | `logActivity()` — append-only audit trail (`server-only`). |
| `components/dashboard/` | All UI for the dashboard. Files are named after the page they primarily serve. |
| `components/dashboard/smart-ai/` | Smart AI chat panel, analytics dashboard, shell layout. |
| `components/dashboard/ai-usage/` | AI credit management and usage display. |
| `components/auth/` | Sign-in form, forgot-password form. |
| `components/ui/` | shadcn/ui primitives. |
| `mcp-service/` | _(Decommissioned)_ — Former MCP chat orchestration service. All logic now in `lib/smart-ai/` and `app/api/smart-ai/`. |
| `scripts/*.sql` | Database migrations. **Run in numeric order, top-down.** |
| `supabase/migrations/` | RAG pgvector schema + chat schema migrations. |
| `proxy.ts` | Edge proxy entry; delegates to `lib/supabase/proxy.ts`. |
| `railway.json` | Railway build + deploy configuration. |
| `next.config.mjs` | Security headers + Server Actions body limit (30 MB) + standalone output. |

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
| Member submits to a task | `TaskSubmissionForm` on task detail | `app/actions/submissions.ts → createSubmission` (rate-limit, deadline check, blob upload, insert submission, mirror assignment, trigger async pipeline) | `submissions`, `task_assignments`, Blob, `activity_log` |
| AI pipeline runs | (background) | `lib/llm/pipeline.ts → processSubmission` (Redis lock → parse → optional vision fallback → run rules + task brief → write `validation_runs` → update submission + assignment) | `submissions`, `task_assignments`, `validation_runs` |
| Manager retries a submission | submission detail → `SubmissionActions` | `app/actions/submissions.ts → retrySubmission` resets status to `queued` then `after(processSubmission)` | `submissions`, `activity_log` |
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
   4. Uploads to Cloudflare R2 with `addRandomSuffix: true`. The URL is unguessable; the client never receives it directly — they go through `/api/download/[id]?type=submission`.
   5. Inserts the `submissions` row with `task_id`, `task_assignment_id`, `is_late`, `late_reason`, `submitted_at`.
   6. **Eagerly mirrors** the matching `task_assignment` to `submitted` / `late_submitted` so manager dashboards reflect status without waiting for the pipeline.
   7. The pipeline route fires `processSubmission()` as a background async function in the Node process.
4. `revalidatePath` for the dashboard, submissions list, the task list, and the specific task detail page.

### 6.4 AI validation pipeline (`lib/pipeline/process.ts`)

1. **Idempotency.** `redis.set("pipeline:lock:{id}", "1", { nx: true, ex: 600 })` — first writer wins for 10 minutes. Releases in `finally`. Prevents duplicate `after()` invocations and racing retries.
2. **LLM rate limit.** `llmLimiter` (60 / 1 min per team). If the team is over budget, the submission is parked at `needs_review` with a warning flag instead of failing.
3. **Parse.** `lib/parse/index.ts → extractText(buf, mime)` dispatches:
   - PDF → `unpdf` native text extraction; if text is sparse (< 16 chars), falls back to page-by-page OCR via `@napi-rs/canvas` + Gemini Vision (`describeImage`).
   - DOCX → `mammoth.extractRawText`.
   - PPTX, XLS, and best-effort `.doc` → `officeparser.parseOffice`.
   - Images → Gemini Vision OCR directly via `describeImage`.
   - Text/Markdown → passthrough.
   - Output is clamped to 60 KB with a `[...truncated...]` marker.
4. **Validate.** Pulls all `enabled` `validation_rules` for the team (with optional `rule_ids` filtering per task). If the submission is for a task with `instructions`, a **synthetic rule** is appended (id `task:{taskId}`, weight 2, threshold 70). All rules run **in parallel** via `Promise.all`. Each call is wrapped in `withRetry(2, exp-backoff)` against OpenRouter 429/5xx.
5. **Persist runs.** Synthetic `task:` rules are filtered out before writing `validation_runs` (they don't have a real FK target).
6. **Aggregate.** Weighted average of rule scores. `passed` requires every rule to pass and no `fail`-severity flag. Any hard fail → `failed`. Otherwise → `needs_review`.
7. **Late preserves late.** If `submission.is_late` was already `true`, the final status is `late_submitted` regardless of the LLM verdict. The aggregate score, summary, and flags still reflect the AI's judgement and surface in the submission detail page.
8. **Mirror.** When the submission has a `task_assignment_id`, the assignment is updated to `submitted` / `late_submitted` (never `failed`/`needs_review` on the assignment row — see the asymmetry note in §4).
9. **Index for RAG.** On successful processing, the submission content is indexed into `rag_documents` (pgvector) so Smart AI can retrieve it.

### 6.5 Cron — missed deadlines, stuck-pipeline recovery, and expiration cleanup

**Scheduling Strategy:** The cron runs via **Railway HTTP cron** hitting `GET /api/cron/mark-missed` every 15 minutes, protected by `CRON_SECRET`. Upstash Redis is used for execution tracking via `lib/upstash-scheduler.ts`.

The handler runs four operations via the admin client:

1. **Mark missed.** `task_assignments.status = 'assigned'` join `tasks` where `due_at < now()` AND `tasks.allow_late = false` → flip to `missed`.
2. **Recover stuck.** Any `submissions.status IN ('queued','parsing','validating')` whose `updated_at` is older than 5 minutes → flip to `failed` with a `"Validation pipeline timed out. Please retry."` flag.
3. **Expire announcements.** Deletes announcements where `expires_at < now()`.
4. **Expire materials.** Deletes materials where `expires_at < now()`, removes R2 blobs, and cleans up RAG index entries.

**Key modules:**
- `app/api/cron/mark-missed/route.ts` — Railway cron endpoint
- `lib/upstash-scheduler.ts` — `recordTaskExecution()` for monitoring

### 6.6 Authenticated download proxy

`/api/download/[id]?type=submission|material` runs `requireProfile()` first (which forces auth + must-reset gate via the proxy chain), then reads the row through the **session-bound** Supabase client so RLS enforces visibility. Once the row is resolved, the route fetches the file from Cloudflare R2 on the server and streams the bytes back with a sensible `Content-Disposition`. The R2 URL never crosses the network to the client.

---

## 7. Module dependency matrix

| Module | Imports from | Imported by | Server-only? |
|---|---|---|---|
| `lib/upstash-scheduler.ts` | `@upstash/redis` | `app/api/cron/mark-missed`, monitoring tools | yes |
| `lib/supabase/admin.ts` | `@supabase/supabase-js` | `app/actions/*`, `lib/pipeline/process.ts`, `lib/activity.ts` | yes |
| `lib/supabase/server.ts` | `@supabase/ssr`, `next/headers` | RSC pages, `lib/auth.ts`, `lib/data.ts`, action handlers | no (RSC compatible) |
| `lib/supabase/client.ts` | `@supabase/ssr` | `components/auth/login-form.tsx` | no (browser) |
| `lib/supabase/proxy.ts` | `@supabase/ssr`, `next/server` | `proxy.ts` (edge) | edge runtime |
| `lib/auth.ts` | `lib/supabase/server.ts`, `next/navigation` | every dashboard page + every action | no |
| `lib/auth-shared.ts` | `lib/types.ts` | client components (sidebar/top-bar/etc) | no — safe for client |
| `lib/data.ts` | `lib/supabase/server.ts`, `lib/types.ts` | RSC pages only | no |
| `lib/activity.ts` | `lib/supabase/admin.ts`, `next/headers` | every action | yes |
| `lib/r2.ts` | `@aws-sdk/client-s3` | `app/actions/submissions.ts`, `app/actions/materials.ts`, `app/api/download/*` | yes |
| `lib/redis.ts` | `@upstash/redis`, `@upstash/ratelimit` | `lib/pipeline/process.ts`, `app/actions/submissions.ts`, `app/api/smart-ai/chat` | yes |
| `lib/email.ts` | native `fetch` (Brevo API) | `app/actions/users.ts` | no |
| `lib/env.ts` | `process.env` | `lib/supabase/*`, `proxy.ts` | no |
| `lib/pipeline/process.ts` | `lib/supabase/admin.ts`, `lib/parse`, `lib/llm/validate.ts`, `lib/smart-ai/indexer.ts` | `app/api/pipeline/[id]/route.ts` | yes |
| `lib/llm/validate.ts` | `ai`, `@ai-sdk/openai`, `zod` | `lib/pipeline/process.ts` | yes |
| `lib/parse/index.ts` | `pdf-parse`, `mammoth`, `officeparser`, `tesseract.js` | `lib/pipeline/process.ts` | yes |
| `lib/smart-ai/indexer.ts` | `lib/supabase/admin.ts`, `@ai-sdk/openai` | `app/actions/*`, `lib/pipeline/process.ts` | yes |
| `lib/smart-ai/retriever.ts` | `lib/supabase/admin.ts`, `@ai-sdk/openai` | `app/api/smart-ai/chat` | yes |
| `lib/smart-ai/client.ts` | native `fetch` | `app/api/smart-ai/chat` | yes |

The “yes” rows all start their files with `import "server-only"` so the bundler hard-fails on accidental client imports.

---

## 8. Environment variables

These must be set on the **Railway** service (`manager-portal`). Locally they go in `.env.local` which is git-ignored.

| Variable | Required by | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | Railway Kong public URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | JWT signed by self-hosted GoTrue |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | RLS bypass — keep secret |
| `R2_ACCOUNT_ID` | server only | Cloudflare R2 account |
| `R2_ACCESS_KEY_ID` | server only | R2 access key |
| `R2_SECRET_ACCESS_KEY` | server only | R2 secret key |
| `R2_BUCKET_NAME` | server only | R2 bucket name |
| `R2_PUBLIC_URL` | server only | R2 public URL (e.g. `https://pub-xxx.r2.dev`) |
| `UPSTASH_REDIS_REST_URL` | server only | rate limit + cron tracking |
| `UPSTASH_REDIS_REST_TOKEN` | server only | as above |
| `OPENROUTER_API_KEY` | server only | OpenRouter API key (validation + Smart AI) |
| `SMART_AI_MODEL` | optional | default: `openai/gpt-4o-mini` |
| `DO_VALIDATION_MODEL` | optional | default: `google/gemini-2.0-flash-001` |
| `DO_SUMMARY_MODEL` | optional | default: `google/gemini-2.0-flash-001` |
| `DO_VISION_MODEL` | optional | default: `google/gemini-2.0-flash-001` |

| `SUPABASE_DB_URL` | optional | Direct Postgres URL for RAG indexer (bypasses PostgREST) |
| `BREVO_API_KEY` | optional | Brevo transactional email |
| `BREVO_SENDER_EMAIL` | optional | Sender address for emails |
| `CRON_SECRET` | server only | shared secret for cron endpoint |
| `NEXT_PUBLIC_SITE_URL` | client + server | public portal URL |

### About `CRON_SECRET`

**CRON_SECRET:** A random opaque token **you generate yourself**. Generate one with:

```bash
openssl rand -hex 32
```

Add `CRON_SECRET = <value>` to *Railway → Service → Variables*. The cron handler checks:

```ts
const auth = request.headers.get("authorization")
if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 })
}
```

If the variable is **unset**, the check is skipped — intentional for local dev. **Always set it on Railway.**

Manual test:

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-deployment>.up.railway.app/api/cron/mark-missed
```

---

## 9. Migrations

Apply SQL files from `scripts/` in the Supabase **SQL Editor** on Railway (Studio → SQL → New query → paste → Run). They are idempotent — safe to re-run.

```
scripts/001_init_schema.sql                       -- tables, enums, indexes
scripts/002_helper_functions.sql                  -- current_user_role, etc + handle_new_user trigger
scripts/003_rls_policies.sql                      -- enable RLS + policies on the original tables
scripts/004_seed_demo_data.sql                    -- optional demo content
scripts/005_tasks_and_late_submissions.sql         -- tasks / assignments / late columns / RLS hardening
scripts/006_security_hardening_and_indexes.sql     -- additional RLS + perf indexes
scripts/006_expiration_for_materials.sql           -- expires_at for announcements/materials
scripts/007_rule_ids_and_delete_policy.sql         -- per-task rule_ids + delete policies
scripts/008_fix_manager_auth.sql                  -- manager auth fixes
scripts/009_assign_managers_to_tasks.sql           -- manager task assignment
supabase/migrations/20260505_rag_documents.sql    -- pgvector + HNSW + search RPCs + RLS
scripts/smart-ai-chat-followup.sql                -- chat_threads/messages/documents schema + RLS
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
- **Forgot password flow** (email-based reset with Brevo)
- Three-role RBAC (main_admin / manager / member) enforced at RLS + middleware + server actions
- **Department management** — full CRUD for teams with member/manager assignment, statistics, bulk operations
- **Tasks system end-to-end:** create, single/bulk assign, member submission, late-with-reason, missed via cron, manager assignment table on the task detail page, per-task rule_ids selection
- Submissions: upload to Cloudflare R2, AI validation via in-process async pipeline, retry, delete
- Native parsers for PDF / DOCX / PPTX / images, with OCR + Gemini Vision fallback
- LLM pipeline with in-process async runner, crash recovery, retry/backoff, structured output via Zod, weighted aggregate
- Per-team validation rules CRUD with `{{TEXT}}` placeholder substitution
- **Smart AI conversational assistant** with native tool-calling, database access, and RAG retrieval
- **Smart AI document upload** with R2 storage + pgvector RAG indexing
- **Smart AI chat threads** with persistent history and thread sidebar
- **AI credit system** — per-user usage quotas with configurable periods (daily/weekly/monthly)
- **Native RAG** — pgvector + BM25 full-text search with RRF fusion, HNSW index
- Announcements + materials (team-scoped, `expires_at` filtering, auto-expiration via Railway HTTP cron)
- **Welcome emails** via Brevo on user provisioning
- Activity log (append-only audit trail; explicit RLS deny on client writes)
- Reports page with daily metrics chart (90-day window)
- Notion-inspired design tokens + Inter / JetBrains Mono fonts
- Security headers (HSTS, X-Frame-Options DENY, CSP, Permissions-Policy), 30 MB Server-Action body limit, generic login error messages
- AlertDialog replacing all `confirm()` / `alert()` calls
- Loading + error boundaries on the dashboard route group
- Mobile bottom nav with safe-area padding
- Authenticated download proxy at `/api/download/[id]` (streams from R2)
- Railway HTTP cron to mark missed assignments + recover stuck submissions + expire announcements/materials
- **Railway deployment** with standalone Next.js builds via Railpack

### In flight / TODO (priority order)

- **Manager UI to call `assignTask`**. The server action is implemented and the SQL RPC `assign_task_to_team` is granted to `authenticated`, but no button surfaces it yet.
- **Realtime status on submission detail.** Subscribe to a Supabase channel so members see `queued → validating → passed` without refreshing.
- **Daily cron rollup of `report_snapshots`.** Reports currently compute from raw `submissions`; precompute to cut DB load.
- **Redis cache on `getDailyMetrics`** (60s TTL) for hot dashboard reads.
- **Read receipts on announcements** — track who has acknowledged.
- **PDF report export** via `@react-pdf/renderer` (CSV is shipped already).
- **CSV streaming export of activity log** for compliance audits.
- **Sentry integration** — server + client.
- **Generate full database types** from the Supabase CLI to replace the loose `Database = any` shim in `lib/supabase/database.types.ts`.
- **Pagination UX on submissions table** — cursor pagination is implemented in `lib/data.ts → listSubmissions`, but the list page does not yet wire it through `searchParams`.
- **Tests** — Playwright happy-paths + unit tests for the AI pipeline with a mocked provider.
- **Team archiving** — soft-delete teams instead of hard delete.

### Known small mismatches

- `app/actions/users.ts → provisionUser` `revalidatePath`s `/dashboard/admin/users`, but no such route exists today. Harmless, just a leftover.
- The `assign_task_to_team` RPC is granted to `authenticated` but only the server action calls it (via the admin client which bypasses RLS anyway). The grant is harmless.

---

## 11. Local dev checklist

```bash
pnpm install
cp .env.local.example .env.local        # fill in your own values
# (Supabase) run scripts/001..009 + RAG migration in the SQL editor, in order
pnpm dev
```

- The first user you create in Supabase becomes `main_admin` automatically (via the `is_first` branch in `handle_new_user()`).
- Watch the Railway / terminal server logs for `[pipeline]`, `[smart-ai]`, `[submissions]`, and `[activity]` lines while testing the upload flow.
- The pipeline runs in-process — no separate dev server needed.
- The cron endpoint can be hit locally with the curl snippet in §8. With `CRON_SECRET` unset locally it returns 200 to any caller, which is fine for dev.

---

## 12. Conventions worth keeping

- **RSC by default; Server Actions for every mutation.** The only client-side Supabase mutation is `signInWithPassword` in the login form — required so the SSR client's cookies refresh on the same response.
- **Every action returns a discriminated `ActionResult`** (`{ ok: true, ... } | { ok: false, error }`). Forms read `res.error` directly into a `role="alert"` block.
- **Server-only modules MUST start with `import "server-only"`.** Already applied to `admin.ts`, `redis.ts`, `activity.ts`, `pipeline.ts`, `validate.ts`, `parse/index.ts`, `indexer.ts`, `retriever.ts`. Any new module under `lib/` that touches service-role secrets, Redis, R2, or Tesseract should follow.
- **Never use `localStorage` for persistence.** All state lives in Supabase.
- **Use design tokens, not hex codes.** `bg-primary`, `text-foreground`, `bg-muted`, etc., defined in `app/globals.css`. The brand primary `#0075de` and the soft accent `#f2f9ff` are wired through tokens; reach for tokens first.
- **Error messages are user-friendly.** "Submission failed: deadline has passed and late submissions are not allowed" — never "FK constraint violated".
- **Always add a Zod schema** at the top of an action file; never trust formData fields. Coerce booleans with `z.coerce.boolean()` and dates by transforming the string yourself (see `tasks.ts → CreateTaskSchema.due_at`).
- **Always re-check ownership on the server**, even if the UI already hid the button. The download proxy is the canonical example: it doesn't trust the URL, it re-reads the row through RLS.
- **Always `revalidatePath`** every page that could now show different data, including the source page so the form gets fresh data on next render.
