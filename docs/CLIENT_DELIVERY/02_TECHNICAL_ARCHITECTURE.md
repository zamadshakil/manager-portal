# Technical Architecture Deep Dive

> **Client Delivery Document** | Part 2 of 6 | Version 2.0 | May 8, 2026

---

## 1. High-Level System Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              CLIENT BROWSER                              │
│    React 19 (Server Components + Client Components)                      │
│    shadcn/ui + Radix UI + Tailwind CSS 4                                 │
└────────────────────────────┬─────────────────────────────────────────────┘
                             │ HTTPS (WebSocket for messaging realtime)
                             ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                       RAILWAY (manager-portal service)                   │
│                          Next.js 16 standalone build                     │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  Edge Proxy (proxy.ts)                                              ││
│  │   • Refreshes Supabase session cookies                              ││
│  │   • Redirects unauthenticated users                                 ││
│  │   • Sets x-pathname header                                          ││
│  └────────────────────────┬────────────────────────────────────────────┘│
│  ┌────────────────────────▼────────────────────────────────────────────┐│
│  │  Next.js App Router                                                 ││
│  │   • RSC pages         • Server Actions          • API Routes        ││
│  │   • In-process AI pipeline (fire-and-forget)                        ││
│  │   • Native Smart AI (chat / RAG / analytics)                        ││
│  │   • Messaging API (REST + Supabase Realtime broker)                 ││
│  └────┬──────────────┬──────────────┬───────────────┬──────────────────┘│
└───────┼──────────────┼──────────────┼───────────────┼───────────────────┘
        │              │              │               │
        ▼              ▼              ▼               ▼
┌────────────────┐ ┌──────────────┐ ┌─────────────┐ ┌─────────────────┐
│ Self-hosted    │ │ Railway       │ │ Cloudflare  │ │ OpenRouter       │
│ Supabase       │ │ Redis         │ │ R2          │ │ Gemini 2.0 Flash │
│ (same project) │ │ (ioredis)     │ │ (S3 API)    │ │ + GPT-4o-mini    │
│                │ │               │ │             │ │                  │
│ Postgres + RLS │ │ Rate limits   │ │ Submissions │ │ Validation +     │
│ pgvector       │ │ Idempotency   │ │ Materials   │ │ Smart AI chat +  │
│ GoTrue Auth    │ │ Cron tracking │ │ Chat docs   │ │ Vision OCR       │
│ Realtime       │ │               │ │ Messaging   │ │                  │
│ PostgREST/Kong │ │               │ │ attachments │ │                  │
└────────────────┘ └──────────────┘ └─────────────┘ └─────────────────┘
                                                    ▲
                                                    │
┌─────────────────┐                                 │
│ Brevo (Email)   │ ◄─── transactional email ───────┘
└─────────────────┘
```

The entire backend lives in a **single Railway project**. There are no Vercel / Inngest / DigitalOcean dependencies — all of that has been migrated.

---

## 2. Application Layer Architecture

### 2.1 Next.js App Router Structure

```
app/
├── layout.tsx              ← Root layout (fonts, vitals reporter)
├── page.tsx                ← Landing redirect
├── globals.css             ← Design token system (light + dark mode)
│
├── auth/                   ← Public authentication pages
│   ├── login/
│   ├── forgot-password/
│   ├── update-password/
│   ├── confirm-email-change/
│   ├── callback/
│   ├── error/
│   └── signout/
│
├── (dashboard)/            ← Route group: all protected pages
│   ├── layout.tsx          ← Dashboard shell (sidebar, top bar, auth gate)
│   └── dashboard/
│       ├── page.tsx        ← Home dashboard (KPIs + charts)
│       ├── submissions/
│       ├── tasks/
│       ├── rules/
│       ├── team/
│       ├── departments/
│       ├── announcements/
│       ├── materials/
│       ├── smart-ai/       ← Conversational assistant (chat + RAG)
│       ├── messages/       ← DMs and group conversations
│       ├── ai-usage/       ← AI credit dashboard
│       ├── activity/
│       ├── reports/
│       └── settings/
│
├── actions/                ← Server Actions (form mutations)
│   ├── submissions.ts
│   ├── tasks.ts
│   ├── rules.ts
│   ├── teams.ts
│   ├── departments.ts
│   ├── announcements.ts
│   ├── materials.ts
│   ├── users.ts
│   ├── profile.ts
│   ├── ai-credits.ts
│   └── auth.ts
│
└── api/                    ← API Routes
    ├── smart-ai/           ← chat, upload, threads, analytics, health, bootstrap
    ├── messaging/          ← conversations, messages, presence, typing, upload
    ├── pipeline/[id]/      ← AI validation trigger + status polling
    ├── cron/mark-missed/   ← Railway HTTP cron entry point
    ├── ai-credits/me/
    ├── download/[id]/      ← RLS-checked R2 streaming proxy
    ├── admin/              ← admin DB utilities
    └── vitals/             ← Web vitals reporter target
```

### 2.2 Library Layer (`lib/`)

| Module | File(s) | Responsibility |
|--------|---------|----------------|
| **Auth** | `auth.ts`, `auth-shared.ts` | Cached profile resolution, role guards, team permission checks |
| **Data** | `data.ts` | All read queries with role-scoped filtering |
| **Types** | `types.ts` | TypeScript interfaces for all entities |
| **Supabase** | `supabase/server.ts`, `admin.ts`, `client.ts`, `proxy.ts` | DB clients (RSC, service-role, browser, edge) |
| **AI Engine** | `llm/validate.ts` | OpenRouter calls (rules, summary, vision) via Vercel AI SDK v6 |
| **Pipeline** | `llm/pipeline.ts`, `pipeline/process.ts` | In-process async submission processor with idempotency lock |
| **Parsers** | `parse/index.ts` | PDF / DOCX / PPTX / XLSX / image / text extraction |
| **Smart AI** | `smart-ai/{indexer,retriever,reranker,client,sliding-window,bootstrap,pg-client}.ts` | Native RAG indexer + hybrid retriever + tool-call client |
| **R2 Storage** | `r2.ts` | S3-compatible client for Cloudflare R2 |
| **Redis** | `redis.ts` | ioredis client + sliding-window rate limiters |
| **Scheduler** | `upstash-scheduler.ts` | Cron execution recording for monitoring |
| **Email** | `email.ts` | Brevo transactional email integration |
| **Activity** | `activity.ts` | Append-only audit log writer |
| **Env** | `env.ts` | Centralised env-var validation |

---

## 3. Database Architecture

### 3.1 Entity Relationship (high level)

```
profiles ──┬── teams ──┬── tasks ──── task_assignments ──┐
           │           │                                  │
           │           ├── validation_rules ───┐          ├── submissions ── validation_runs
           │           │                       │          │
           │           ├── announcements       │          └── (results)
           │           └── materials           │
           │                                   │
           ├── chat_threads ── chat_messages   │
           │                └─ chat_documents  │
           │                                   │
           ├── rag_documents (pgvector + tsv)  │
           │                                   │
           ├── ai_credit_limits / ai_usage_log │
           │                                   │
           ├── conversations ── conversation_members
           │     └── messages ── message_reactions
           │
           └── activity_log (audit trail)
```

### 3.2 Key Database Tables

| Table | Purpose |
|-------|---------|
| `profiles` | 1:1 with Supabase Auth users; role, team, must_reset, soft-delete flag |
| `teams` | Organisational units with a designated manager |
| `tasks` | Work items with deadlines, late policy, optional `rule_ids[]` and AI brief |
| `task_assignments` | Many-to-many: which member has which task, status mirror |
| `submissions` | Uploaded files with AI processing results |
| `validation_rules` | Per-team LLM prompts with thresholds and weights (+ global rules) |
| `validation_runs` | Per-rule-per-submission scoring records |
| `rag_documents` | pgvector embedded chunks for Smart AI retrieval (HNSW + tsvector) |
| `chat_threads` / `chat_messages` / `chat_documents` | Smart AI persistence |
| `ai_credit_limits` / `ai_usage_log` | Per-user AI credit quotas + ledger |
| `conversations` / `conversation_members` | Messaging containers (DM / group) |
| `messages` / `message_reactions` | Message bodies (with reply_to, soft-delete, attachments) and emoji reactions |
| `announcements` / `materials` | Team communications with `expires_at` |
| `activity_log` | Immutable record of every action |
| `report_snapshots` | Pre-computed analytics rollups (table reserved, not yet populated) |

### 3.3 Database Migrations

Migrations are split into two stages so the schema is reproducible from a clean Postgres:

**Foundational** (`scripts/`, run in numeric order):

| File | Purpose |
|------|---------|
| `001_init_schema.sql` | Core tables, enums, indexes |
| `002_helper_functions.sql` | RPCs (`assign_task_to_team`, role helpers, `handle_new_user`) |
| `003_rls_policies.sql` | RLS policies for the original tables |
| `004_seed_demo_data.sql` | Optional demo data |
| `005_tasks_and_late_submissions.sql` | Tasks system + late-submission columns + RLS hardening |
| `006_security_hardening_and_indexes.sql` | Additional RLS + perf indexes |
| `006_expiration_for_materials.sql` | `expires_at` on announcements/materials |
| `007_rule_ids_and_delete_policy.sql` | Per-task `rule_ids` + delete policies |
| `smart-ai-chat-followup.sql` | `chat_threads` / `chat_messages` / `chat_documents` schema |

**Incremental** (`supabase/migrations/`, timestamped — apply in order):

```
20260501_global_validation_rules.sql        (+ 0502 RLS fixes)
20260502_fix_manager_auth.sql
20260503_late_submission_deadline.sql
20260504_chat_persistence_base.sql / smart_ai_chat.sql
20260505_rag_documents.sql / rag_documents_fixup.sql
20260506_rag_full_setup.sql / rag_rpc.sql
20260506_ai_credits_setup.sql / ai_usage_increment_rpc.sql
20260506_ensure_materials_expiration.sql
20260506_gotrue_refresh_token_fix.sql
20260506_invalidate_sessions_rpc.sql
20260507_add_materials_expiration.sql
20260507_ai_usage_ledger.sql
20260507_credit_chat_rpcs.sql
20260507_email_change_verification.sql
20260508_messaging.sql                       (conversations / messages / reactions + RLS + realtime publication + find_dm_conversation RPC)
20260508_profile_soft_delete.sql
20260509_messaging_security_critical.sql
20260510_messaging_correctness.sql
20260511_messaging_perf.sql
20260512_messaging_ux.sql
```

---

## 4. Security Architecture (Defense in Depth)

```
Request → Layer 1: Edge Proxy (proxy.ts, runs on every request)
            │  ✓ Refresh Supabase session cookie
            │  ✓ Redirect unauthenticated users
            │  ✓ Set x-pathname header
            ▼
         Layer 2: Server Actions / API Routes
            │  ✓ requireProfile() / requireRole() (cached per-request)
            │  ✓ Zod schema validation on all inputs
            │  ✓ canManageTeam() — team ownership check
            │  ✓ Redis rate limiting (uploads / LLM / chat / messaging)
            │  ✓ Cross-team assignment prevention
            ▼
         Layer 3: Database RLS (PostgreSQL)
            │  ✓ Row-Level Security on every table
            │  ✓ Members only see own submissions
            │  ✓ Managers only see own team's data
            │  ✓ Service-role used only for pipeline / activity writes
            ▼
         Response with Security Headers
            ✓ HSTS (2-year max-age, preload)
            ✓ Content-Security-Policy (strict)
            ✓ X-Frame-Options: DENY
            ✓ Referrer-Policy: strict-origin-when-cross-origin
            ✓ Permissions-Policy (camera, mic, geo disabled)
```

### Rate Limiting (Railway Redis, sliding window)

| Limiter | Scope | Default |
|---------|-------|---------|
| Upload | Per user | 20 / 10 min |
| LLM Validation | Per team | 60 / min |
| Smart AI Chat | Per user | configurable via env |
| Messaging Send | Per user / per conversation | configurable, fail-closed in prod |
| Pipeline Lock | Per submission | 1 concurrent (10 min TTL) |

---

## 5. AI Validation Pipeline (In-Process)

The pipeline used to run on Inngest. It now runs **in-process** as a fire-and-forget async function, kicked off by the Server Action that creates the submission. Crash recovery is handled by the Railway HTTP cron job (`/api/cron/mark-missed`) which sweeps any submissions stuck in `queued` / `parsing` / `validating` for more than 5 minutes back to `failed`.

```
Server Action createSubmission()
        │
        ├──── R2 upload → INSERT submission (status: "queued")
        ├──── INSERT/UPDATE task_assignments (status: "submitted" or "late_submitted")
        └──── after(processSubmission(id))  ◄── fire-and-forget
                  │
                  ▼
          Redis SETNX idempotency lock (10 min TTL)
                  │
                  ▼
          Step 1: Parse
          ├──── PDF  → unpdf  (+ Gemini Vision OCR fallback)
          ├──── DOCX → mammoth
          ├──── PPTX/XLSX → officeparser
          └──── Image → Gemini Vision
                  │   set status: "parsing"
                  ▼
          Step 2: Validate (status: "validating")
          ├──── Run each enabled rule via OpenRouter → Gemini 2.0 Flash
          ├──── Append optional task-specific AI brief as a rule
          └──── Persist validation_runs (one row per rule)
                  │
                  ▼
          Step 3: Summarise
          └──── Executive summary + topic extraction + predictive flags
                  │
                  ▼
          Step 4: Finalise
          ├──── Compute weighted aggregate score
          ├──── Set submission.status: passed / failed / needs_review / late_submitted
          ├──── Mirror onto task_assignments
          ├──── Index extracted text into rag_documents (pgvector + tsvector)
          └──── logActivity("submission.processed")
```

### AI Models Used

| Model | Provider | Use Case |
|-------|----------|----------|
| `google/gemini-2.0-flash-001` | OpenRouter | Rule validation + summarisation + vision OCR (default for `DO_VALIDATION_MODEL`, `DO_SUMMARY_MODEL`, `DO_VISION_MODEL`) |
| `openai/gpt-4o-mini` | OpenRouter | Smart AI chat + tool-calling (default for `SMART_AI_MODEL`, configurable) |
| `openai/text-embedding-3-small` | OpenAI (or OpenRouter fallback) | RAG document chunk embeddings (1536-dim, HNSW) |

---

## 6. Messaging Subsystem

| Layer | Responsibility |
|-------|----------------|
| `app/(dashboard)/dashboard/messages/page.tsx` | RSC entry point that hydrates the messaging shell |
| `components/dashboard/messaging/*` | Sidebar, conversation view, list, composer, info sheets, typing indicator |
| `app/api/messaging/*` | REST endpoints for conversations, members, messages, reactions, typing, presence, attachment upload |
| `hooks/use-conversation-realtime.ts` | Client-side Supabase Realtime subscription (INSERT/UPDATE/DELETE on `messages`, `message_reactions`, `conversation_members`) |
| `supabase/migrations/20260508_messaging.sql` (+ `_security_critical`, `_correctness`, `_perf`, `_ux`) | Schema, RLS, realtime publication, helpers |

Permissions:
- Any authenticated user can DM or group-chat any other user — no team scoping.
- `conversation_members.role` (`admin` / `member`) gates rename/avatar updates and member removal in groups.
- Senders can edit and soft-delete (`deleted_at`) their own messages.
- Reactions are scoped to conversation members.
- Attachments go through `/api/messaging/upload` → Cloudflare R2; the resulting URL is stored in `messages.media_url` with `media_metadata` (size, mime, dimensions).

---

*Next: [03 — Glossary of Terms](./03_GLOSSARY.md)*
