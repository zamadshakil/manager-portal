# Hierarchia Manager Portal — Project Status & Architecture

> Living document. Update this file whenever you ship a feature, change an
> architectural decision, or merge a major refactor. A new contributor
> should be able to read just this file plus `README.md` and orient
> themselves in under fifteen minutes.

Last reviewed: 2026-04-29 (full end-to-end flow audit)

---

## 0. TL;DR for new developers

- **Framework:** Next.js 16 (App Router), React 19, Server Actions, RSC-first.
- **Auth:** Supabase Auth (email/password). Provision-only — no public sign-up.
- **Database:** Supabase Postgres with RLS on every table.
- **Files:** Vercel Blob, fronted by an authenticated download proxy.
- **AI:** Groq (via the Vercel AI SDK) for validation + summarisation; Tesseract OCR with a Groq Vision fallback for images.
- **Background work:** Next.js `after()` for the validation pipeline; Vercel Cron for missed-deadline sweeps and stuck-submission recovery.
- **Rate limit / idempotency:** Upstash Redis.
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

Authentication is **Supabase Auth** (email + password) with **provision-only onboarding**. There is no public sign-up. Data lives in **Supabase Postgres** behind RLS. Files live in **Vercel Blob** with download proxied through a server route that re-checks RLS. The AI pipeline runs on **Groq via the AI SDK**, with **Tesseract.js + Groq Vision** for OCR fallback. Per-user/per-team rate-limiting and per-submission idempotency live in **Upstash Redis**.

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
                             |  after() jobs          +----->|  Vercel Blob         |
                             |  Vercel Cron entry     |      |  (random-suffix URL) |
                             |                        |      +----------------------+
                             |                        |
                             |                        |      +----------------------+
                             |                        +----->|  Upstash Redis       |
                             |                        |      |  rate limit + lock   |
                             |                        |      +----------------------+
                             |                        |
                             |                        |      +----------------------+
                             |                        +----->|  Groq via AI SDK     |
                             |                        |      |  + Tesseract OCR     |
                             +------------------------+      +----------------------+
                                       ^
                                       |
                            +--------------------+
                            |  Vercel Cron       |
                            |  every 15 minutes  |
                            |  /api/cron/        |
                            |  mark-missed       |
                            +--------------------+
```

### Major source areas

| Folder | Purpose |
|---|---|
| `app/(dashboard)/dashboard/` | All authenticated routes. RSC-first; the route-group layout enforces session and renders top-bar/sidebar/mobile-nav. |
| `app/auth/` | Login, OAuth callback, signout, error page. |
| `app/actions/` | Server Actions: `submissions`, `tasks`, `materials`, `announcements`, `users`, `rules`, `profile`. Each validates with Zod, re-checks role with `requireRole`, writes to Supabase, then `revalidatePath`s. |
| `app/api/` | Route handlers: `/api/download/[id]` (RLS-checked file streaming), `/api/cron/mark-missed` (scheduled job). |
| `lib/supabase/` | `client.ts` (browser SSR), `server.ts` (RSC + actions), `admin.ts` (service-role; **`server-only`**), `proxy.ts` (middleware session refresh + must-reset gate), `database.types.ts` (loose stub today; see §10 known issues). |
| `lib/llm/` | `pipeline.ts` (orchestrator), `validate.ts` (Zod-typed Groq calls + retry/backoff). |
| `lib/parse/` | Format-specific parsers: PDF (`pdf-parse`), DOCX (`mammoth`), PPTX/.doc (`officeparser`), images (Tesseract → Groq Vision fallback). |
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
| Member submits to a task | `TaskSubmissionForm` on task detail | `app/actions/submissions.ts → createSubmission` (rate-limit, deadline check, blob upload, insert submission, mirror assignment, queue `after(processSubmission)`) | `submissions`, `task_assignments`, Blob, `activity_log` |
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
   4. Uploads to Vercel Blob with `addRandomSuffix: true`. The URL is unguessable; the client never receives it directly — they go through `/api/download/[id]?type=submission`.
   5. Inserts the `submissions` row with `task_id`, `task_assignment_id`, `is_late`, `late_reason`, `submitted_at`.
   6. **Eagerly mirrors** the matching `task_assignment` to `submitted` / `late_submitted` so manager dashboards reflect status without waiting for the pipeline.
   7. `after(processSubmission(id))` schedules the AI pipeline.
4. `revalidatePath` for the dashboard, submissions list, the task list, and the specific task detail page.

### 6.4 AI validation pipeline (`lib/llm/pipeline.ts`)

1. **Idempotency.** `redis.set("pipeline:lock:{id}", "1", { nx: true, ex: 600 })` — first writer wins for 10 minutes. Releases in `finally`. Prevents duplicate `after()` invocations and racing retries.
2. **LLM rate limit.** `llmLimiter` (60 / 1 min per team). If the team is over budget, the submission is parked at `needs_review` with a warning flag instead of failing.
3. **Parse.** `lib/parse/index.ts → extractText(buf, mime)` dispatches:
   - PDF → `pdf-parse` (we import the inner `pdf-parse/lib/pdf-parse.js` to skip its eager test-fixture read that crashes serverless).
   - DOCX → `mammoth.extractRawText`.
   - PPTX (and best-effort `.doc`) → `officeparser.parseOfficeAsync`.
   - Images → Tesseract; if confidence is low or the text is sparse, falls back to **Groq Vision** (`describeImage`).
   - Output is clamped to 60 KB with a `[...truncated...]` marker.
4. **Vision fallback** triggers when the file is an image AND (text length < 60 OR OCR confidence < 60). The vision result wins only if it's longer than the OCR result.
5. **Validate.** Pulls all `enabled` `validation_rules` for the team. If the submission is for a task with `instructions`, a **synthetic rule** is appended (id `task:{taskId}`, weight 2, threshold 70). All rules run **in parallel** via `Promise.all`. Each call is wrapped in `withRetry(3, exp-backoff)` against Groq 429/5xx.
6. **Persist runs.** Synthetic `task:` rules are filtered out before writing `validation_runs` (they don't have a real FK target).
7. **Aggregate.** Weighted average of rule scores. `passed` requires every rule to pass and no `fail`-severity flag. Any hard fail → `failed`. Otherwise → `needs_review`.
8. **Late preserves late.** If `submission.is_late` was already `true`, the final status is `late_submitted` regardless of the LLM verdict. The aggregate score, summary, and flags still reflect the AI's judgement and surface in the submission detail page.
9. **Mirror.** When the submission has a `task_assignment_id`, the assignment is updated to `submitted` / `late_submitted` (never `failed`/`needs_review` on the assignment row — see the asymmetry note in §4).

### 6.5 Cron — missed deadlines and stuck-pipeline recovery

`vercel.json` schedules `/api/cron/mark-missed` every **15 minutes** (`*/15 * * * *`). The handler is protected by `Authorization: Bearer ${CRON_SECRET}` (see §8). It runs two queries via the admin client:

1. **Mark missed.** `task_assignments.status = 'assigned'` join `tasks` where `due_at < now()` AND `tasks.allow_late = false` → flip to `missed`.
2. **Recover stuck.** Any `submissions.status IN ('queued','parsing','validating')` whose `updated_at` is older than 30 minutes → flip to `failed` with a `"Validation pipeline timed out. Please retry."` flag. This is the failsafe for `after()` invocations that crashed silently.

The endpoint returns `{ ok, missedCount, stuckRecovered }` so it's easy to verify with curl.

### 6.6 Authenticated download proxy

`/api/download/[id]?type=submission|material` runs `requireProfile()` first (which forces auth + must-reset gate via the proxy chain), then reads the row through the **session-bound** Supabase client so RLS enforces visibility. Once the row is resolved, the route fetches the unguessable Blob URL on the server and streams the bytes back with a sensible `Content-Disposition`. The Blob URL never crosses the network to the client.

---

## 7. Module dependency matrix

| Module | Imports from | Imported by | Server-only? |
|---|---|---|---|
| `lib/supabase/admin.ts` | `@supabase/supabase-js` | `app/actions/*`, `lib/llm/pipeline.ts`, `lib/activity.ts`, `app/api/cron/*` | yes |
| `lib/supabase/server.ts` | `@supabase/ssr`, `next/headers` | RSC pages, `lib/auth.ts`, `lib/data.ts`, action handlers | no (RSC compatible) |
| `lib/supabase/client.ts` | `@supabase/ssr` | `components/auth/login-form.tsx` | no (browser) |
| `lib/supabase/proxy.ts` | `@supabase/ssr`, `next/server` | `proxy.ts` (edge) | edge runtime |
| `lib/auth.ts` | `lib/supabase/server.ts`, `next/navigation` | every dashboard page + every action | no |
| `lib/auth-shared.ts` | `lib/types.ts` | client components (sidebar/top-bar/etc) | no — safe for client |
| `lib/data.ts` | `lib/supabase/server.ts`, `lib/types.ts` | RSC pages only | no |
| `lib/activity.ts` | `lib/supabase/admin.ts`, `next/headers` | every action | yes |
| `lib/redis.ts` | `@upstash/redis`, `@upstash/ratelimit` | `lib/llm/pipeline.ts`, `app/actions/submissions.ts` | yes |
| `lib/llm/pipeline.ts` | `lib/supabase/admin.ts`, `lib/parse`, `lib/llm/validate.ts`, `lib/redis.ts` | `app/actions/submissions.ts` (via `after()`) | yes |
| `lib/llm/validate.ts` | `ai`, `@ai-sdk/groq`, `zod` | `lib/llm/pipeline.ts` | yes |
| `lib/parse/index.ts` | `pdf-parse`, `mammoth`, `officeparser`, `tesseract.js` | `lib/llm/pipeline.ts` | yes |

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
| `UPSTASH_REDIS_REST_URL` | server only | rate limit + idempotency |
| `UPSTASH_REDIS_REST_TOKEN` | server only | as above |
| `GROQ_API_KEY` | server only | used by the AI SDK Groq provider |
| `GROQ_VALIDATION_MODEL` | optional | defaults to `llama-3.3-70b-versatile` |
| `GROQ_SUMMARY_MODEL` | optional | defaults to `llama-3.3-70b-versatile` |
| `GROQ_VISION_MODEL` | optional | defaults to `llama-3.2-90b-vision-preview` |
| `CRON_SECRET` | server only | shared secret for the cron endpoint — see below |

### About `CRON_SECRET`

It's a random opaque token **you generate yourself**. There is no service that issues it. Generate one with:

```bash
openssl rand -hex 32
```

Add `CRON_SECRET = <value>` to *Vercel → Project → Settings → Environment Variables* for Production (and Preview if you want preview crons to fire). When Vercel Cron triggers `/api/cron/mark-missed`, it sends `Authorization: Bearer ${CRON_SECRET}` automatically because the project-level env var is paired with the schedule. The route checks:

```ts
const auth = request.headers.get("authorization")
if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 })
}
```

If the variable is **unset**, the check is skipped. That is intentional for local dev so `curl http://localhost:3000/api/cron/mark-missed` works without ceremony. **Always set it on Vercel** — otherwise anyone can trigger the job.

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
- Native parsers for PDF / DOCX / PPTX / images, with OCR + Vision fallback
- LLM pipeline with idempotency lock, retry/backoff, structured output via Zod, weighted aggregate
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
- **Tests** — Playwright happy-paths + unit tests for the AI pipeline with a mocked Groq provider.

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
