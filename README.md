# Hierarchia Manager Portal

A comprehensive task and assignment management platform with AI-powered document validation, a conversational Smart AI assistant, and full team management. Built with Next.js 16, self-hosted Supabase on Railway, and Railway-native background processing.

## Overview

The Hierarchia Manager Portal enables organizations to:

- **Create & Manage Tasks** — Organize hierarchical task structures with deadlines and submission rules
- **Assign to Teams** — Distribute tasks to members with role-based permissions
- **Process Submissions** — Validate submissions with an AI pipeline (Gemini 2.0 Flash via OpenRouter)
- **Smart AI Assistant** — Conversational AI with native RAG retrieval, tool-calling against live database, and document uploads
- **Messaging** — In-app DMs and group conversations with realtime delivery, typing/presence, reactions, replies, file attachments, and Slack-style read receipts
- **Department Management** — Full CRUD for departments with member assignment and statistics
- **Track Progress** — Monitor assignment status with real-time updates and deadline alerts
- **AI Credit System** — Per-user usage quotas with configurable periods (daily/weekly/monthly)
- **Automated Workflows** — In-process async pipeline for AI validation + Railway HTTP cron for scheduled cleanup

## Tech Stack

- **Framework**: Next.js 16 (App Router), React 19, Tailwind CSS 4
- **Database**: Self-hosted Supabase on Railway (PostgreSQL + pgvector + GoTrue Auth + PostgREST + Kong)
- **Background Work**: In-process async pipeline (fire-and-forget) + Railway HTTP cron (every 15 min)
- **AI — Validation**: OpenRouter → Gemini 2.0 Flash (via Vercel AI SDK v6) for rule-based document grading + summarisation + vision OCR
- **AI — Smart AI Chat**: OpenRouter → GPT-4o-mini (configurable) with native tool-calling + RAG retrieval
- **RAG**: Native pgvector (1536-dim, HNSW index) with RRF fusion (vector + BM25 full-text)
- **File Storage**: Cloudflare R2 (S3-compatible)
- **Realtime**: Supabase Realtime (WebSocket subscriptions for messaging + assignments)
- **Caching & Rate Limiting**: Railway-native Redis (via `REDIS_URL`, ioredis client)
- **Email**: Brevo (transactional welcome emails + email-change verification)
- **Deployment**: Railway (all services in a single project)

## Railway Infrastructure

The entire backend runs in a single Railway project. Smart AI (chat
orchestration, RAG indexing/retrieval, analytics) is **native** inside
the Next.js app — there are no longer any sibling MCP or RAG services.

```
Railway Project
├── manager-portal        — Next.js 16 app (this repo, includes native Smart AI)
└── Supabase (self-hosted)
    ├── Kong              — API gateway (public URL)
    ├── PostgREST          — REST API for Postgres
    ├── GoTrue Auth        — Authentication
    ├── Supabase Studio    — Database admin UI
    ├── Supabase Storage   — File storage (+ S3 + Imgproxy)
    ├── Supabase Realtime  — WebSocket subscriptions
    ├── Postgres           — Primary database (+ pgvector)
    └── Postgres Meta      — Schema introspection
```

## Getting Started

### Prerequisites

- Node.js 22+ (see `engines` in package.json)
- Git
- Access to the Railway project (or credentials from your team)

### Local Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/JobFlowAI/manager-portal.git
   cd manager-portal
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.local.example .env.local
   ```
   Edit `.env.local` and add your actual credentials. See `.env.local.example` for detailed instructions on where to find each value.

4. **Start the development server**
   ```bash
   pnpm dev
   ```
   Open [http://localhost:3000](http://localhost:3000) to see the application.

> **Note:** The AI validation pipeline runs in-process — no separate background service is needed locally.

## Project Structure

```
app/
├── api/
│   ├── smart-ai/           # Smart AI endpoints (chat, upload, threads, analytics, health, bootstrap)
│   ├── messaging/           # Messaging endpoints (conversations, messages, presence, typing, upload)
│   ├── pipeline/[id]/       # AI validation pipeline trigger + status polling
│   ├── cron/mark-missed/    # Railway HTTP cron endpoint (scheduled jobs)
│   ├── ai-credits/me/       # AI credit quota endpoint
│   ├── download/            # Authenticated file download proxy
│   ├── admin/               # Admin database utilities
│   └── vitals/              # Web vitals reporting
├── actions/                 # Server actions (submissions, tasks, materials, announcements,
│                            #   departments, users, rules, profile, ai-credits)
├── auth/                    # Auth pages (login, forgot-password, update-password,
│                            #   callback, signout, error)
├── (dashboard)/             # Protected dashboard routes
│   └── dashboard/
│       ├── smart-ai/        # Smart AI chat portal
│       ├── messages/        # Messaging UI (DMs + groups)
│       ├── tasks/           # Task management
│       ├── submissions/     # Submission management
│       ├── departments/     # Department management (admin)
│       ├── team/            # Team member management
│       ├── rules/           # Validation rules editor
│       ├── announcements/   # Announcements
│       ├── materials/       # Materials library
│       ├── reports/         # Reports & analytics
│       ├── ai-usage/        # AI credit usage dashboard
│       ├── activity/        # Activity log
│       └── settings/        # User profile & password
├── globals.css              # Design system tokens (Tailwind CSS 4)
└── layout.tsx               # Root layout

components/
├── ui/                      # shadcn/ui primitives
├── auth/                    # Login form, forgot-password form
├── dashboard/               # All dashboard UI components
│   ├── smart-ai/            # Smart AI chat panel, analytics, shell
│   ├── messaging/           # Conversation sidebar, message list/composer, info sheets, typing indicator
│   └── ai-usage/            # AI credit management UI
└── web-vitals-reporter.tsx  # Performance monitoring

lib/
├── supabase/                # Supabase clients (admin, server, client, proxy)
├── smart-ai/                # RAG indexer, retriever, reranker, sliding-window, pg-client
├── llm/                     # LLM pipeline orchestrator (pipeline.ts) + validator (validate.ts)
├── pipeline/                # In-process async submission processor (process.ts)
├── parse/                   # Document parsers (PDF via unpdf, DOCX, PPTX, images via Gemini Vision)
├── data.ts                  # All read queries (single source of truth)
├── auth.ts                  # Role-based auth helpers
├── r2.ts                    # Cloudflare R2 storage client
├── redis.ts                 # Railway-native Redis (ioredis) + rate limiters
├── email.ts                 # Brevo email integration
├── env.ts                   # Centralized env-var validation
├── types.ts                 # TypeScript type definitions
├── activity.ts              # Audit trail logging
└── upstash-scheduler.ts     # Cron execution tracking

supabase/
└── migrations/              # SQL migrations (RAG pgvector, chat, AI credits, etc.)

scripts/                     # DB migrations (001-009), backfill scripts, schema fixes

docs/                        # Architecture docs, audit reports, delivery guides
```

## Key Features

### Task Management
- Hierarchical task organization with per-task validation rule selection
- Due date tracking with automatic missed-status enforcement
- Late submission rules (`allow_late`, `require_late_reason`, `late_submission_deadline`)
- Task metadata and versioning

### AI Validation Pipeline (In-Process Async)
1. Task created with deadlines → assigned to team members
2. Members submit documents (PDF, DOCX, PPTX, XLSX, images, text up to 25 MB)
3. Pipeline runs as a fire-and-forget async function in the Node.js process:
   - **Parse**: Extract text via `unpdf`, `mammoth`, `officeparser`, or Gemini Vision OCR
   - **Validate**: Run each validation rule via Gemini 2.0 Flash (structured output, Zod schema)
   - **Summarize**: Generate executive summary + predictive flags
   - **Score**: Weighted aggregate across all rules
   - **Index**: Push to RAG for Smart AI retrieval
4. Results saved to `submissions` + `validation_runs`

### Smart AI Assistant
- Conversational AI with tool-calling against the live Supabase database
- Native RAG retrieval (pgvector + BM25 full-text, RRF fusion, keyword reranking)
- Document upload + indexing for chat-attached files
- Persistent chat threads with history
- Per-user AI credit quotas

### Messaging
- Direct messages and group conversations between any portal users
- Realtime message delivery via Supabase Realtime (WebSocket)
- Typing indicators, presence, reactions, replies, edit/delete
- File / image / audio / video attachments uploaded to R2 via `/api/messaging/upload`
- Per-conversation `last_read_at` for unread counts; soft-delete for messages
- RLS-enforced visibility (members of the conversation only)

### Department Management
- Full CRUD for departments (teams)
- Member assignment and transfer
- Manager assignment with statistics
- Bulk operations

### Scheduled Jobs (Railway HTTP Cron — Every 15 Minutes)
- **Mark Missed**: Updates assignments past `due_at` to "missed" if late submissions are disallowed
- **Auto-fail Stuck**: Recovers submissions stuck in `queued`/`parsing`/`validating` for 5+ minutes
- **Expire Announcements**: Deletes announcements past their `expires_at` date + removes from RAG
- **Expire Materials**: Deletes materials past their `expires_at` + removes blobs from R2 + removes from RAG

### Security
- Row-Level Security (RLS) on all tables
- Three-layer authorization: Middleware → Server Action → Postgres RLS
- Server actions validate inputs with Zod and re-check ownership
- `CRON_SECRET` protects scheduled endpoints
- Security headers (HSTS, X-Frame-Options DENY, CSP, Permissions-Policy)
- `server-only` imports prevent accidental client-side credential leaks

## Development Workflow

### Common Commands
```bash
pnpm dev              # Start Next.js dev server
pnpm build            # Production build
pnpm start            # Run production build
pnpm lint             # ESLint check
```

### Database Migrations
Apply SQL files in order. Foundational schema lives in `scripts/`; everything from RAG onward is in `supabase/migrations/` (timestamped).

Foundational (`scripts/`):
```
scripts/001_init_schema.sql
scripts/002_helper_functions.sql
scripts/003_rls_policies.sql
scripts/004_seed_demo_data.sql              (optional)
scripts/005_tasks_and_late_submissions.sql
scripts/006_security_hardening_and_indexes.sql
scripts/006_expiration_for_materials.sql
scripts/007_rule_ids_and_delete_policy.sql
scripts/smart-ai-chat-followup.sql           (chat threads/messages/documents)
```

Incremental (`supabase/migrations/`, timestamped — apply in order):
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
20260508_messaging.sql                        (conversations/messages/reactions + RLS + realtime publication)
20260508_profile_soft_delete.sql
20260509_messaging_security_critical.sql
20260510_messaging_correctness.sql
20260511_messaging_perf.sql
20260512_messaging_ux.sql
```

Key tables:
- `profiles` — Users with roles (`main_admin`, `manager`, `member`); supports soft-delete
- `teams` — Departments/teams
- `tasks` — Task definitions with instructions and deadline rules
- `task_assignments` — Per-member assignment instances
- `submissions` — Uploaded documents with AI validation results
- `validation_rules` — Team-scoped AI grading rules (+ global rules)
- `validation_runs` — Per-rule AI evaluation results
- `rag_documents` — pgvector document chunks for Smart AI RAG
- `chat_threads` / `chat_messages` / `chat_documents` — Smart AI conversation persistence
- `ai_credit_limits` / `ai_usage_log` — AI credit quota system
- `conversations` / `conversation_members` / `messages` / `message_reactions` — Messaging
- `announcements` / `materials` — Team communications
- `activity_log` — Append-only audit trail

### Environment Variables

See [`.env.local.example`](./.env.local.example) for the complete list with documentation. Key groups:

| Group | Variables | Purpose |
|-------|-----------|---------|
| **Supabase** | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Self-hosted Supabase via Kong on Railway |
| **LLM** | `OPENROUTER_API_KEY`, `OPENAI_API_KEY` (optional), `SMART_AI_MODEL`, `EMBEDDING_MODEL` | OpenRouter for chat completions; OpenAI direct for embeddings (preferred — falls back to OpenRouter) |
| **Validation** | `DO_VALIDATION_MODEL`, `DO_SUMMARY_MODEL`, `DO_VISION_MODEL` | Model overrides (default: Gemini 2.0 Flash) |
| **Storage** | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` | Cloudflare R2 |
| **Redis** | `REDIS_URL` | Railway-native Redis — rate limiting, idempotency locks, cron observability |
| **Email** | `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` | Transactional emails |
| **Security** | `CRON_SECRET` | Cron endpoint authentication |
| **App** | `NEXT_PUBLIC_SITE_URL`, `NODE_ENV` | Application configuration |
| **Database** | `SUPABASE_DB_URL` (optional) | Direct Postgres for RAG indexer (bypasses PostgREST) |

## Deployment

### Deploy to Railway

The application deploys as a single service in the Railway project:

1. **manager-portal** — Next.js standalone build via Railpack
   - `railway.json` configures the builder and start command
   - `next.config.mjs` sets `output: "standalone"` for optimized container builds
   - All Smart AI logic (chat orchestration, RAG indexing/retrieval, analytics) runs inside this container — no extra hop, no extra service to manage.

The self-hosted Supabase stack (Postgres, Kong, GoTrue, PostgREST, Storage, Realtime, Studio, Imgproxy, S3, Postgres Meta) runs alongside it in the same Railway project.

### Post-Deployment Checklist
- [ ] Verify all environment variables are set on each Railway service
- [ ] Run database migrations via Supabase Studio SQL Editor
- [ ] Configure Railway cron to hit `GET /api/cron/mark-missed` every 15 minutes with `Authorization: Bearer $CRON_SECRET`
- [ ] Test Smart AI chat with a sample query
- [ ] Verify cron job execution via Railway logs

## Documentation

- **[DOCUMENTATION.md](./DOCUMENTATION.md)** — Documentation index and navigation
- **[docs/PROJECT_STATUS.md](./docs/PROJECT_STATUS.md)** — Complete architecture and data model
- **[docs/SMART_AI_AUDIT.md](./docs/SMART_AI_AUDIT.md)** — Smart AI/MCP/RAG subsystem audit
- **[docs/CODEBASE_AUDIT.md](./docs/CODEBASE_AUDIT.md)** — Code quality assessment
- **[DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md)** — Full deployment verification

## Contributing

1. Create a feature branch from `main`
2. Make changes and test locally
3. Commit with clear messages
4. Open a pull request for review

## Team

Built by **JobFlowAI** for efficient task and assignment management.

## License

Proprietary — All rights reserved.

## Support

For issues, questions, or feature requests, please open a GitHub issue or contact the team.

---

**Last Updated:** May 8, 2026
