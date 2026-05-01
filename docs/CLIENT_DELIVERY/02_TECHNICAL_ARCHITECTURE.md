# Technical Architecture Deep Dive

> **Client Delivery Document** | Part 2 of 6

---

## 1. High-Level System Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              CLIENT BROWSER                              │
│    React 19 (Server Components + Client Components)                      │
│    Shadcn/ui + Radix UI + Tailwind CSS 4                                │
└────────────────────────────┬─────────────────────────────────────────────┘
                             │ HTTPS
                             ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                           VERCEL EDGE NETWORK                            │
│                                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────────────┐  │
│  │ Edge Proxy  │  │ Static Assets│  │ Security Headers (HSTS, CSP)  │  │
│  │ (middleware)│  │ (CDN cached) │  │ Vercel Analytics               │  │
│  └──────┬──────┘  └──────────────┘  └────────────────────────────────┘  │
│         │                                                                │
│         ▼                                                                │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │                    NEXT.JS 16 APP ROUTER                         │    │
│  │                                                                  │    │
│  │  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────┐   │    │
│  │  │   Server    │  │   Server     │  │    API Routes         │   │    │
│  │  │ Components  │  │   Actions    │  │  /api/cron/*          │   │    │
│  │  │ (RSC)       │  │  (mutations) │  │  /api/pipeline/*      │   │    │
│  │  └──────┬──────┘  └──────┬───────┘  │  /api/download/*      │   │    │
│  │         │                │          │  /api/inngest          │   │    │
│  │         │                │          └───────────┬────────────┘   │    │
│  │         ▼                ▼                      │               │    │
│  │  ┌──────────────────────────────────────────────┘               │    │
│  │  │              SHARED SERVER LAYER                              │    │
│  │  │  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌────────────┐ │    │
│  │  │  │ lib/auth │  │ lib/data │  │ lib/llm/* │  │lib/parse/* │ │    │
│  │  │  │ (cached) │  │ (queries)│  │(AI engine)│  │ (parsers)  │ │    │
│  │  │  └────┬─────┘  └────┬─────┘  └─────┬─────┘  └─────┬──────┘ │    │
│  │  └───────┼──────────────┼──────────────┼──────────────┼────────┘    │
│  └──────────┼──────────────┼──────────────┼──────────────┼────────────┘ │
└─────────────┼──────────────┼──────────────┼──────────────┼──────────────┘
              │              │              │              │
              ▼              ▼              ▼              ▼
┌─────────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│   Supabase      │ │ Upstash      │ │ DigitalOcean │ │ Vercel Blob  │
│   PostgreSQL    │ │ Redis        │ │ AI Inference  │ │ (file store) │
│   + Auth        │ │ (rate limit) │ │ (LLM models)  │ │              │
└─────────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

---

## 2. Application Layer Architecture

### 2.1 Next.js App Router Structure

```
app/
├── layout.tsx              ← Root layout (fonts, analytics, preconnect hints)
├── page.tsx                ← Landing redirect
├── globals.css             ← Design token system (light + dark mode)
│
├── auth/                   ← Public authentication pages
│   ├── login/
│   └── callback/
│
├── (dashboard)/            ← Route group: all protected pages
│   ├── layout.tsx          ← Dashboard shell (sidebar, top bar, auth gate)
│   └── dashboard/
│       ├── page.tsx        ← Home dashboard (KPIs + charts)
│       ├── submissions/    ← Submission management
│       ├── tasks/          ← Task management
│       ├── rules/          ← Validation rule config
│       ├── team/           ← Team management
│       ├── departments/    ← Department overview
│       ├── announcements/  ← Announcements
│       ├── materials/      ← Shared materials
│       ├── activity/       ← Audit log viewer
│       ├── reports/        ← Analytics
│       └── settings/       ← User settings
│
├── actions/                ← Server Actions (form mutations)
│   ├── submissions.ts      ← createSubmission, retrySubmission, deleteSubmission
│   ├── tasks.ts            ← createTask, assignTask, deleteTask
│   ├── rules.ts            ← upsertRule, deleteRule
│   ├── teams.ts            ← createTeam, updateTeam, deleteTeam
│   ├── departments.ts      ← department management
│   ├── announcements.ts    ← announcements CRUD
│   ├── materials.ts        ← materials CRUD
│   ├── users.ts            ← user provisioning
│   └── profile.ts          ← profile updates
│
└── api/                    ← API Routes
    ├── cron/mark-missed/   ← Scheduled deadline enforcement
    ├── pipeline/[id]/      ← AI validation trigger
    ├── download/[id]/      ← Secure file downloads
    ├── inngest/            ← Inngest webhook endpoint
    └── vitals/             ← Web vitals reporting
```

### 2.2 Library Layer (`lib/`)

| Module | File(s) | Responsibility |
|--------|---------|----------------|
| **Auth** | `auth.ts`, `auth-shared.ts` | Cached profile resolution, role guards, team permission checks |
| **Data** | `data.ts` | All database read queries with role-scoped filtering |
| **Types** | `types.ts` | TypeScript interfaces for all database entities |
| **Supabase** | `supabase/server.ts`, `admin.ts`, `client.ts`, `proxy.ts` | Database client factory (user-scoped, admin, browser, edge) |
| **AI Engine** | `llm/validate.ts` | LLM calls: rule evaluation, summarization, vision OCR |
| **Pipeline** | `llm/pipeline.ts` | End-to-end submission processing orchestrator |
| **Parsers** | `parse/index.ts` | Document text extraction (PDF, DOCX, PPTX, images) |
| **Background Jobs** | `inngest/client.ts`, `functions.ts` | Durable async pipeline via Inngest steps |
| **Redis** | `redis.ts` | Redis client, upload rate limiter, LLM rate limiter |
| **Scheduler** | `upstash-scheduler.ts` | Cron execution recording for monitoring |
| **Activity** | `activity.ts` | Append-only audit log writer |
| **Utils** | `utils.ts`, `format.ts` | CN helper, date/number formatting |

---

## 3. Database Architecture

### 3.1 Entity Relationship Diagram

```
┌─────────────┐       ┌───────────────┐       ┌────────────────────┐
│   teams     │       │   profiles    │       │  validation_rules  │
│─────────────│       │───────────────│       │────────────────────│
│ id (PK)     │◄──┐   │ id (PK/FK)   │   ┌──►│ id (PK)            │
│ name        │   │   │ email        │   │   │ team_id (FK)       │
│ description │   │   │ full_name    │   │   │ rule_name          │
│ manager_id  │───┘   │ role         │   │   │ prompt_template    │
│ settings    │       │ team_id (FK) │───┘   │ threshold          │
│ created_at  │       │ manager_id   │       │ weight             │
│ updated_at  │       │ must_reset   │       │ enabled            │
└─────────────┘       │ avatar_url   │       │ created_by (FK)    │
                      └──────────────┘       └────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
┌───────────────┐   ┌────────────────┐   ┌───────────────────┐
│    tasks      │   │  submissions   │   │  announcements    │
│───────────────│   │────────────────│   │───────────────────│
│ id (PK)       │   │ id (PK)        │   │ id (PK)           │
│ team_id (FK)  │   │ uploader_id    │   │ author_id (FK)    │
│ manager_id    │   │ team_id (FK)   │   │ team_id (FK)      │
│ title         │   │ title          │   │ title, body       │
│ instructions  │   │ blob_url       │   │ priority          │
│ rule_ids      │   │ mime_type      │   │ expires_at        │
│ due_at        │   │ status         │   └───────────────────┘
│ allow_late    │   │ score          │
│ require_late  │   │ summary        │   ┌───────────────────┐
└───────┬───────┘   │ extracted_text │   │   materials       │
        │           │ flags (JSONB)  │   │───────────────────│
        ▼           │ metadata       │   │ id (PK)           │
┌────────────────┐  │ task_id (FK)   │   │ author_id (FK)    │
│task_assignments│  │ is_late        │   │ blob_url          │
│────────────────│  └───────┬────────┘   │ tags[]            │
│ id (PK)        │          │            └───────────────────┘
│ task_id (FK)   │          ▼
│ assignee_id    │  ┌────────────────┐   ┌───────────────────┐
│ status         │  │validation_runs │   │  activity_log     │
│ submission_id  │  │────────────────│   │───────────────────│
│ late_reason    │  │ id (PK)        │   │ id (PK)           │
│ submitted_at   │  │ submission_id  │   │ actor_id          │
└────────────────┘  │ rule_id (FK)   │   │ action            │
                    │ model          │   │ entity_type       │
                    │ pass, score    │   │ entity_id         │
                    │ reasons[]      │   │ metadata (JSONB)  │
                    │ flags[]        │   │ ip_address        │
                    │ latency_ms     │   └───────────────────┘
                    └────────────────┘
```

### 3.2 Key Database Tables

| Table | Records | Purpose |
|-------|---------|---------|
| `profiles` | Users | 1:1 with Supabase Auth users; stores role, team assignment |
| `teams` | Departments | Organizational units with a designated manager |
| `tasks` | Assignments | Work items with deadlines and validation config |
| `task_assignments` | Links | Many-to-many: which member has which task |
| `submissions` | Documents | Uploaded files with AI processing results |
| `validation_rules` | AI Rules | Per-team LLM prompts with thresholds and weights |
| `validation_runs` | AI Results | Per-rule-per-submission scoring records |
| `announcements` | Messages | Team-wide notices with priority and expiry |
| `materials` | Resources | Shared reference documents |
| `activity_log` | Audit | Immutable record of every action |
| `report_snapshots` | Metrics | Pre-computed analytics snapshots |

### 3.3 Database Migrations

Seven sequential migrations build the schema:

| Migration | Purpose |
|-----------|---------|
| `001_init_schema.sql` | Core tables, enums, indexes |
| `002_helper_functions.sql` | RPC functions (assign_task_to_team, etc.) |
| `003_rls_policies.sql` | Row-Level Security policies for all tables |
| `004_seed_demo_data.sql` | Demo data for development |
| `005_tasks_and_late_submissions.sql` | Task system, late submission support |
| `006_security_hardening_and_indexes.sql` | Performance indexes, RPC optimizations |
| `007_rule_ids_and_delete_policy.sql` | Per-task rule selection, delete policies |

---

## 4. Security Architecture (Defense in Depth)

```
Request → Layer 1: Edge Proxy (middleware)
            │  ✓ Refresh Supabase session cookie
            │  ✓ Redirect unauthenticated users
            │  ✓ Set x-pathname header
            ▼
         Layer 2: Route Guards (layout/page)
            │  ✓ requireProfile() — must be logged in
            │  ✓ requireRole() — must have correct role
            │  ✓ must_reset check — force password change
            ▼
         Layer 3: Server Actions (mutations)
            │  ✓ Zod schema validation on all inputs
            │  ✓ canManageTeam() — team ownership check
            │  ✓ Rate limiting (Upstash Redis)
            │  ✓ Cross-team assignment prevention
            ▼
         Layer 4: Database RLS (PostgreSQL)
            │  ✓ Row-Level Security on every table
            │  ✓ Members only see own submissions
            │  ✓ Managers only see own team's data
            │  ✓ Service-role used only for pipeline writes
            ▼
         Response with Security Headers
            ✓ HSTS, CSP, X-Frame-Options, Referrer-Policy
```

### Rate Limiting

| Limiter | Scope | Limit | Window |
|---------|-------|-------|--------|
| Upload | Per user | 20 uploads | 10 minutes |
| LLM Calls | Per team | 60 validations | 1 minute |
| Pipeline Lock | Per submission | 1 concurrent | 10 min TTL |

---

## 5. AI Pipeline Architecture (Inngest)

The pipeline uses **Inngest** for durable, step-based execution:

```
Event: "app/submission.process"
        │
        ▼
Step 1: "load-submission-and-rules"
        │  Load submission, task, and team validation rules
        │  Skip if already in terminal state
        ▼
Step 2: "update-status-parsing"
        │  Set status → "parsing"
        ▼
Step 3: "extract-text"
        │  Download from Vercel Blob
        │  Route to correct parser (PDF/DOCX/PPTX/Image)
        │  Images → AI Vision model (Nemotron VL)
        ▼
Step 4: "update-status-validating"
        │  Save extracted text preview (2000 chars)
        │  Set status → "validating"
        ▼
Step 5-N: "run-rule-{rule-id}" (one per rule)
        │  Each rule is its own Inngest step
        │  Independent retry on failure
        │  DeepSeek V3 scores 0-100
        ▼
Step N+1: "generate-summary"
        │  Executive summary + predictive flags
        ▼
Step N+2: "finalize-submission"
        │  Weighted score aggregation
        │  Persist validation_runs
        │  Set final status: passed/failed/needs_review
```

### AI Models Used

| Model | Provider | Use Case |
|-------|----------|----------|
| `deepseek-3.2` (DeepSeek V3) | DigitalOcean AI | Text validation + summarization |
| `nemotron-nano-12b-v2-vl` | DigitalOcean AI | Image OCR / vision extraction |

---

*Next: [03 — Glossary of Terms](./03_GLOSSARY.md)*
