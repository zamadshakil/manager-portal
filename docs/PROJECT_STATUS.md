# Manager Portal — Project Status

> Living document. Update this file whenever you ship a feature, change an
> architectural decision, or merge a major refactor. New contributors should
> be able to read just this file plus `README.md` and orient themselves in
> under fifteen minutes.

Last updated: 2026-04-29

---

## 1. What we are building

A web portal where **managers assign document-style tasks** (PDF, DOCX, PPTX,
images) to **team members**, and an **AI pipeline grades each submission**
against (a) team-level standing rules and (b) the optional brief attached to
that specific task. The portal handles deadlines, late submissions with
reasons, missed submissions, audit logs, and per-team scoping.

Three roles:

| Role | What they can do |
|---|---|
| **Main Admin** | Provision managers, create teams, see everything across all teams. |
| **Manager** | Owns one team. Provisions members, configures validation rules, creates tasks (single or bulk-assigned), reviews submissions. |
| **Member** | Sees their assigned tasks, uploads submissions, reads announcements, downloads materials. |

Authentication is **Supabase Auth** (email + password), with **provision-only
onboarding** — there is no public signup. Data is in **Supabase Postgres**
behind RLS. Files are in **Vercel Blob** with download proxied through a
server route that re-checks RLS. The AI pipeline runs on **Groq via the AI
SDK**, with **Tesseract.js + Groq Vision** for OCR fallback. Rate-limiting
and per-submission idempotency live in **Upstash Redis**.

---

## 2. High-level architecture

```
+-------------------+      +--------------------+      +----------------------+
|  Browser          |      |  Next.js 16 (App   |      |  Supabase            |
|  (RSC + actions)  |<---->|  Router) on Vercel |<---->|  Postgres + Auth     |
+-------------------+      |                    |      |  + RLS               |
                           |  Server Actions    |      +----------------------+
                           |  Route handlers    |
                           |  proxy.ts          |      +----------------------+
                           |  after() jobs      +----->|  Vercel Blob         |
                           |                    |      +----------------------+
                           |                    |      +----------------------+
                           |                    +----->|  Upstash Redis       |
                           |                    |      |  (rate limit + idem) |
                           |                    |      +----------------------+
                           |                    |      +----------------------+
                           |                    +----->|  Groq (AI SDK)       |
                           |                    |      |  + Tesseract OCR     |
                           +--------------------+      +----------------------+
                                     |
                                     v
                            +--------------------+
                            |  Vercel Cron       |
                            |  /api/cron/        |
                            |  mark-missed       |
                            +--------------------+
```

### Major source areas

| Folder | Purpose |
|---|---|
| `app/(dashboard)/dashboard/` | All authenticated routes. RSC-first; layout enforces session and renders top-bar/sidebar/mobile-nav. |
| `app/auth/` | Login, password reset, OAuth callback, signout. |
| `app/actions/` | Server Actions: `submissions`, `tasks`, `materials`, `announcements`, `users`, `rules`, `profile`. Each action validates input with Zod, re-checks role with `requireRole`, writes to Supabase, then `revalidatePath`s. |
| `app/api/` | Route handlers: `/api/download/[id]` (RLS-checked file streaming), `/api/cron/mark-missed` (scheduled job). |
| `lib/supabase/` | `client.ts` (browser), `server.ts` (RSC + actions), `admin.ts` (service-role; **`server-only`**), `proxy.ts` (middleware session refresh + must-reset gate), `database.types.ts`. |
| `lib/llm/` | `pipeline.ts` (orchestrator), `validate.ts` (Zod-typed Groq calls + retry/backoff). |
| `lib/parse/` | Format-specific parsers: PDF (`pdf-parse`), DOCX (`mammoth`), PPTX (`officeparser`), images (Tesseract → Groq Vision fallback). |
| `lib/data.ts` | All read queries used by RSC pages. |
| `lib/auth.ts` | `requireProfile`, `requireRole`, `canManageTeam`. |
| `lib/redis.ts` | Upstash client + `uploadLimiter()` + `llmLimiter()` (`server-only`). |
| `lib/activity.ts` | `logActivity()` — append-only audit trail (`server-only`). |
| `components/dashboard/` | All UI; named after the page they primarily serve. |
| `components/ui/` | shadcn/ui primitives. |
| `scripts/*.sql` | Database migrations. **Run in numeric order, top-down.** |

---

## 3. Data model

The schema is in `scripts/001_init_schema.sql`. The recent additions in
`scripts/005_tasks_and_late_submissions.sql` are highlighted.

```
auth.users                                                              (Supabase managed)
   │
   ▼
profiles (id PK = auth.users.id)
  ├── role: main_admin | manager | member
  ├── team_id (FK -> teams)
  ├── manager_id (FK -> profiles)
  └── must_reset (forces password change on first login)

teams                                       announcements (team_id null = global; admins only)
  ├── manager_id (FK -> profiles)           materials     (team_id null = global; admins only)
  └── settings jsonb                        validation_rules (team-scoped)

submissions
  ├── uploader_id, team_id
  ├── blob_url, blob_pathname, mime_type, size_bytes
  ├── status (queued / parsing / validating / passed / failed / needs_review
  │           / late_submitted / missed)                                   <-- 005
  ├── score, summary, extracted_text, flags jsonb
  ├── task_id (FK -> tasks)                                                <-- 005
  ├── task_assignment_id (FK -> task_assignments)                          <-- 005
  ├── is_late, late_reason, submitted_at                                   <-- 005
  └── timestamps

tasks                                                                       <-- 005
  ├── team_id (FK -> teams), manager_id (FK -> profiles)
  ├── title, description, instructions (used by AI at submit time)
  ├── due_at, allow_late, require_late_reason
  └── timestamps

task_assignments                                                            <-- 005
  ├── task_id, assignee_id (UNIQUE together)
  ├── status (assigned / submitted / late_submitted / missed)
  ├── submission_id (FK -> submissions)
  ├── late_reason, submitted_at
  └── timestamps

validation_runs              -- one per (submission, rule) pair, written by service role
activity_log                 -- append-only audit trail, written by service role
report_snapshots             -- precomputed dashboard rollups (planned, not yet populated)
```

### RLS model

Every table has RLS enabled. Helper SQL functions
(`current_user_role`, `current_user_team`, `is_manager_of`, `is_main_admin`,
all `SECURITY DEFINER`) live in `scripts/002_helper_functions.sql` and are
re-created in `scripts/005` for safety.

Service-role (the admin client in `lib/supabase/admin.ts`) bypasses RLS and
is used for: creating the validation pipeline output, bulk-assigning tasks,
the cron job, retrying submissions. **Never import `admin.ts` from the
browser** — it is annotated `import "server-only"`.

---

## 4. Critical flows

### 4.1 Provisioning a new user

1. Main Admin or Manager opens **`/dashboard/team`**.
2. Submits the **Provision User** form (`components/dashboard/provision-user-form.tsx`).
3. `app/actions/users.ts → provisionUser` calls `auth.admin.createUser` with a
   temporary password and `must_reset: true` in `raw_user_meta_data`.
4. The DB trigger `handle_new_user()` (script 002) creates the matching
   `profiles` row.
5. The new user logs in and is force-redirected to `/dashboard/settings?reset=1`
   by `lib/supabase/proxy.ts` until they change their password.

### 4.2 Manager creates and assigns a task

1. Manager opens **`/dashboard/tasks`**.
2. Fills `TaskComposer` (`components/dashboard/task-composer.tsx`), choosing:
   - title, description, instructions for the AI
   - deadline, late policy, late-reason policy
   - assign mode: **whole team** or **selected members**
3. Server Action `createTask` (`app/actions/tasks.ts`):
   1. Validates with Zod and `canManageTeam`.
   2. Inserts the `tasks` row.
   3. Bulk-inserts `task_assignments` rows via the **service-role client**
      (after authorization is checked above).
   4. `logActivity('task.created')`.
4. Members see the task in `/dashboard/tasks` and on their dashboard
   `MyTasks` widget.

### 4.3 Member submits to a task

1. Member opens **`/dashboard/tasks/[id]`**, sees `TaskSubmissionForm`.
2. Form computes overdue state client-side and shows or blocks accordingly:
   - On time → straightforward upload.
   - Overdue + `allow_late=true` → reason field is required (≥ 8 chars).
   - Overdue + `allow_late=false` → submission button is disabled and the
     server action also returns "Submission failed: deadline has passed".
3. Server Action `createSubmission` (`app/actions/submissions.ts`):
   1. Validates file type (`ACCEPTED_MIME_TYPES`) and size (`MAX_FILE_SIZE_BYTES`).
   2. Per-user rate limit via `uploadLimiter()`.
   3. **Re-checks task ownership and deadline rules.** Trust-no-client.
   4. Uploads to Vercel Blob with `addRandomSuffix: true` (URL is unguessable;
      it is never returned directly to the browser — clients use
      `/api/download/[id]?type=submission`).
   5. Inserts the `submissions` row with `task_id`, `task_assignment_id`,
      `is_late`, `late_reason`, `submitted_at`.
   6. Eagerly updates the matching `task_assignment` to
      `submitted` / `late_submitted` so manager dashboards reflect status
      without waiting for the pipeline.
   7. `after(processSubmission(id))` schedules the AI pipeline.

### 4.4 The AI validation pipeline

`lib/llm/pipeline.ts → processSubmission`:

1. **Idempotency:** `redis.set("submission:{id}:run", "1", { nx: true, ex: 86400 })`.
   Returns early if a run is already in flight.
2. **Parse:** `lib/parse/index.ts → extractText(blobUrl, mime)`:
   - PDF → `pdf-parse` (with the `lib/pdf-parse.js` inner-path workaround).
   - DOCX → `mammoth`.
   - PPTX (and best-effort `.doc`) → `officeparser`.
   - Images → Tesseract; if confidence is low, falls back to **Groq Vision**.
   - Text is truncated to 60 KB with a `[...truncated...]` marker.
3. **Validate:** for every enabled `validation_rules` row of the submission's
   team, plus the task's `instructions` brief, call `runRule`:
   - `{{TEXT}}` placeholder is substituted before sending.
   - `generateObject` is wrapped in `withRetry(3, exponentialBackoff)` against
     Groq 429/5xx.
4. **Aggregate:** weighted average of rule scores + threshold logic decides
   `passed` / `needs_review` / `failed`. A `summarize()` call produces the
   human summary + `predictive_flags`.
5. **Persist:** writes `validation_runs` rows and updates the submission.
6. **Mirror to assignment:** if the submission was tied to a task assignment,
   the assignment's status is finalized to match the submission verdict
   (`submitted` / `late_submitted` are kept; `failed` keeps the assignment
   row the same — managers see verdict via `submission.status`).

### 4.5 Missed deadlines + stuck pipelines

`/api/cron/mark-missed` runs every 10 minutes (configured in `vercel.json`):

1. For every `task_assignment` still in `assigned` whose task's `due_at` has
   passed AND whose task forbids late submissions → flip to `missed`.
2. For every submission stuck in `queued` / `parsing` / `validating` for
   >30 minutes → flip to `failed` with a "pipeline timed out" flag so users
   can retry. (Failsafe for crashed `after()` runs.)

The route is protected by a `Bearer ${CRON_SECRET}` header that **Vercel Cron
sets automatically** when triggering scheduled jobs. See §7.

### 4.6 Downloads

`/api/download/[id]?type=submission|material` looks up the row, runs the
exact same RLS check the page would, then **streams the bytes through the
server**. The Blob URL never leaves the server. This makes the random-suffix
URLs effectively private without paying for signed-URL infrastructure.

---

## 5. Security posture

| Layer | What | Where |
|---|---|---|
| Network | HSTS, Referrer-Policy, X-Frame-Options DENY, X-Content-Type-Options nosniff, Permissions-Policy | `next.config.mjs → headers()` |
| App | Server-Action body limit raised to 30 MB | `next.config.mjs → experimental.serverActions` |
| App | Login error messages are generic ("Email or password is incorrect") to prevent user enumeration | `components/auth/login-form.tsx` |
| App | `must_reset` middleware gate | `lib/supabase/proxy.ts` |
| Database | RLS enabled on every table; helpers in 002 + tightening in 005 | `scripts/00*.sql` |
| Database | Explicit `with check (false)` on `activity_log`, `validation_runs`, `report_snapshots` so client tokens cannot write them even by mistake | 005 |
| Storage | Random suffix on Blob path; download proxy re-checks RLS | `app/api/download/[id]/route.ts` |
| Pipeline | `import "server-only"` on `redis.ts`, `activity.ts`, `admin.ts`, `pipeline.ts`, `parse/*` | various |
| Pipeline | Idempotency key per-submission run | `lib/llm/pipeline.ts` |
| Pipeline | Exponential backoff on Groq 429/5xx (3 retries) | `lib/llm/validate.ts` |
| Rate limiting | Upload + LLM rate limit per user via Upstash | `lib/redis.ts` |

---

## 6. Environment variables

The following must be set on Vercel (Production + Preview). They are loaded
from a private, **never-committed** `.env.local` for local dev. The reference
list (no real values, just keys) is at the top of `README.md`.

| Variable | Required by | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | from Supabase project settings |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | RLS-bound public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | RLS bypass — keep secret |
| `BLOB_READ_WRITE_TOKEN` | server only | Vercel Blob (auto-injected on Vercel) |
| `UPSTASH_REDIS_REST_URL` | server only | rate limit + idempotency |
| `UPSTASH_REDIS_REST_TOKEN` | server only | as above |
| `GROQ_API_KEY` | server only | AI SDK |
| `CRON_SECRET` | server only | see §7 |

> **Never commit `.env*` files.** `.gitignore` excludes them; CI fails if a
> secret pattern appears in a committed diff.

---

## 7. About `CRON_SECRET`

`CRON_SECRET` is a **random string you generate yourself** that the cron
endpoint uses to verify a request really came from Vercel Cron (and not from
a random visitor pinging the URL).

### What it is

It's just a long random opaque token. There is no "official" service that
issues it. Pick any cryptographically random value, e.g.:

```bash
openssl rand -hex 32
# 8d3f9c1e6b5a7f0c2e4d8b6a1f3c9e7d5b2a4c6e8f0d2b4a6c8e0f2d4b6a8c0e
```

…or in JavaScript: `crypto.randomUUID()` repeated twice and concatenated.

### Where it goes

1. **On Vercel** → *Project → Settings → Environment Variables* → add
   `CRON_SECRET = <your random value>` for **Production** (and Preview if
   you want preview crons to fire too). Save and redeploy.
2. **Locally** (only if you plan to call the cron route from `curl`) → add
   the same key to your `.env.local`.

### How it works

When Vercel Cron triggers `/api/cron/mark-missed`, it sends an
`Authorization: Bearer ${CRON_SECRET}` header automatically because of how
Vercel pairs scheduled jobs with the project's env. The route in
`app/api/cron/mark-missed/route.ts` checks:

```ts
const auth = request.headers.get("authorization")
if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 })
}
```

If the env var is **unset**, the check is skipped (development convenience).
On Vercel **always set it**, otherwise anyone can hit the endpoint and run
the job repeatedly.

### How to test it manually

```bash
curl -i \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-deployment>.vercel.app/api/cron/mark-missed
```

Expected response: `200 OK` with a JSON body listing how many assignments
were marked missed and how many stuck submissions were recovered.

---

## 8. Migration playbook

Apply migrations from the **Supabase SQL Editor** (Project → SQL → New
query → paste → Run). Migrations are idempotent — safe to re-run.

**Order from a fresh database:**

```
scripts/001_init_schema.sql                ← tables, enums, indexes
scripts/002_helper_functions.sql           ← current_user_role, etc.
scripts/003_rls_policies.sql               ← enable + write policies
scripts/004_seed_demo_data.sql             ← optional demo data
scripts/005_tasks_and_late_submissions.sql ← tasks + late + RLS hardening
```

If you only want the latest changes on top of an existing DB, running
**005 alone is safe**: it re-creates any missing helpers and skips anything
that already exists.

### Common migration gotchas

- `ALTER TYPE ... ADD VALUE` cannot run inside a transaction or `DO $$ … $$`
  block in Postgres. Script 005 keeps those statements at the top level.
- Supabase SQL editor wraps the entire pasted snippet in a transaction. If
  you ever need to add new enum values **interactively**, run those single
  statements first, then run the rest of the migration.

---

## 9. Status — done vs. remaining

### Shipped

- [x] Supabase auth with provision-only onboarding + forced password reset gate
- [x] Three-role RBAC (main_admin, manager, member) enforced at RLS + app layer
- [x] Submissions: upload, AI validation, retry, delete
- [x] Native parsers for PDF / DOCX / PPTX / images (with OCR + Vision fallback)
- [x] LLM pipeline with idempotency, retry/backoff, structured output via Zod
- [x] Per-team validation rules CRUD with `{{TEXT}}` substitution
- [x] Announcements + materials (team-scoped, expires_at filtering)
- [x] Activity log (append-only audit trail)
- [x] Reports page with daily metrics chart
- [x] **Tasks system end-to-end:** create, single/bulk assign, member submission, late-with-reason, missed via cron, manager assignment table
- [x] Notion-inspired design tokens + Geist fonts
- [x] Security headers, body limit raised, generic login errors
- [x] AlertDialog replacing all `confirm()` / `alert()` calls
- [x] Loading + error boundaries on the dashboard route group
- [x] Mobile bottom nav with safe-area padding
- [x] Download proxy re-checking RLS (`/api/download/[id]`)
- [x] Cron route to mark missed assignments + recover stuck submissions

### In flight / TODO

- [ ] **Realtime status on submission detail** — Supabase Realtime channel so
      members see "queued → validating → passed" without refresh.
- [ ] **Daily cron rollup of `report_snapshots`** — currently `/dashboard/reports`
      computes from raw `submissions`; precompute to cut DB load.
- [ ] **Redis cache on `getDailyMetrics`** (60s TTL) for hot dashboard reads.
- [ ] **Read receipts on announcements** — track who has acknowledged.
- [ ] **PDF report export** via `@react-pdf/renderer` (CSV is already shipped).
- [ ] **CSV streaming export of activity log** — for compliance audits.
- [ ] **Sentry integration** — server + client, with the Sentry MCP wired in.
- [ ] **Generate full Database types** from Supabase CLI to replace the loose
      `Database = any` shim in `lib/supabase/database.types.ts`.
- [ ] **Pagination UX on submissions table** — cursor pagination is implemented
      in `lib/data.ts → listSubmissions`, but the list page does not yet wire
      it through `searchParams`.
- [ ] **Tests** — Playwright happy-paths, plus unit tests for the AI pipeline
      with a mocked Groq provider.
- [ ] **Cleanup** — `lib/supabase/database.types.ts` is currently a stub; remove
      the duplicate hooks under `components/ui/use-*` (none ship today, just be
      careful when re-adding shadcn primitives).

---

## 10. Local dev checklist

```bash
pnpm install
cp .env.local.example .env.local        # then fill in your own values
# (Supabase) run scripts/001..005 in the SQL editor, in order
pnpm dev
```

- Test login at `http://localhost:3000/auth/login` with the first user you
  created in Supabase → that user automatically gets `main_admin` because of
  the `is_first` branch in `handle_new_user()`.
- Watch the v0/Vercel server logs for `[v0]` and `[submissions]` lines while
  testing the upload flow.
- The cron endpoint can be hit locally with the curl snippet in §7. With
  `CRON_SECRET` unset locally it returns 200 to any caller, which is fine
  for dev.

---

## 11. Conventions worth keeping

- **RSC by default; Server Actions for every mutation.** No client-side
  Supabase mutations except `signInWithPassword` (justified — refresh of
  cookies must happen via the SSR client first thing).
- **Every action returns a discriminated `ActionResult`** (`{ ok: true, ... }
  | { ok: false, error }`). Forms read `res.error` directly into a
  `role="alert"` block.
- **Server-only modules MUST start with `import "server-only"`.** Already
  applied to `admin.ts`, `redis.ts`, `activity.ts`, `pipeline.ts`,
  `parse/index.ts`. New modules in `lib/` that touch service-role secrets,
  Redis, Blob, or Tesseract should follow.
- **Never use `localStorage` for persistence.** All state lives in Supabase.
- **Use design tokens, not hex codes.** `bg-primary`, `text-foreground`,
  `bg-muted`, etc., defined in `app/globals.css`. Brand exceptions are the
  Hierarchia primary `#0075de` and the soft accent `#f2f9ff` (already wired
  in tokens).
- **Error messages are user-friendly.** "Submission failed: deadline has
  passed and late submissions are not allowed" — never "FK constraint
  violated".
