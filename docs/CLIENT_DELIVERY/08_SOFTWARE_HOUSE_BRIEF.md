# Hierarchia — Software House Technical Brief
### For Price Estimation & Scope Review

> **Prepared by:** JobFlowAI  
> **Purpose:** Price estimation request — we have an existing, fully functional production system and want an independent assessment of scope, complexity, and rebuild/replication cost from an experienced software house.  
> **Date:** May 2026

---

## 1. What Is Hierarchia?

**Hierarchia** is an AI-powered task, document, and team management platform built for organizations that need structured workflow management with automated document validation, intelligent AI assistance, real-time collaboration, and enterprise-grade security.

### The One-Liner
> "Hierarchia replaces manual document review and scattered team communication with a unified AI-driven portal — tasks, submissions, AI validation, messaging, and analytics in one place."

### The Problem It Solves

| Without Hierarchia | With Hierarchia |
|---|---|
| Managers manually review every submitted document | AI validates documents automatically against configurable rules |
| No visibility into submission status or deadlines | Real-time dashboard with pass rates, scores, and deadline tracking |
| Late submissions go untracked | Automatic deadline enforcement with late-submission policies |
| No audit trail of who did what | Full append-only activity logging with actor, IP, and timestamp |
| Team management scattered across tools | Unified portal with role-based access for admins, managers, and members |
| No internal AI assistant with access to live data | Conversational AI that queries the live database via tool-calling + RAG |

---

## 2. User Roles

| Role | Who They Are | What They Can Do |
|------|-------------|-----------------|
| **Main Admin** | System administrator | Create teams, provision users, see everything across all teams, manage global settings |
| **Manager** | Team lead | Create tasks, configure AI rules, assign work, review submissions, manage their team |
| **Member** | Team participant | View assigned tasks, upload document submissions, track progress, use Smart AI |

All three roles share the **same application** but see a completely different interface and have strictly enforced data boundaries.

---

## 3. Complete Feature List

### 3.1 Task & Assignment Management
- Create tasks with title, description, instructions, and deadlines
- Bulk-assign tasks to entire teams or selectively assign to specific members
- Late submission policies: allow/deny late uploads, configurable late deadline, require late reason
- Automatic missed-deadline enforcement via scheduled background jobs
- Per-task validation rule selection (choose which AI rules apply to this task)
- Task status tracking: assigned → submitted / late_submitted / missed
- Task edit and delete with audit logging

### 3.2 Document Submission System
- Members upload files against assigned tasks
- Supported formats: **PDF, DOCX, PPTX, XLSX, PNG, JPEG, plain text, Markdown** (up to 25 MB)
- Real-time status tracking: queued → parsing → validating → passed/failed/needs_review
- Late submission detection and reason capture
- Submission history with download proxy (RLS-checked, URL unguessable)
- Resubmission prevention once window closes

### 3.3 AI Document Validation Pipeline (In-Process Async)
Full AI pipeline runs automatically on every submission:

1. **Parse** — extract text via `unpdf` (PDF), `mammoth` (DOCX), `officeparser` (PPTX/XLSX), Gemini Vision OCR (images/scanned PDFs)
2. **Validate** — run configurable validation rules via Gemini 2.0 Flash, each rule scores 0–100 with pass/fail and reasons
3. **Summarize** — generate executive summary, topic extraction, predictive risk flags
4. **Score** — compute weighted aggregate across all rules
5. **Index** — push extracted text + summary into pgvector for Smart AI RAG retrieval

Pipeline features:
- Per-submission Redis idempotency lock (prevents duplicate runs)
- Crash recovery via cron job (auto-retries stuck submissions after 5 min)
- Rate limiting per team (60 LLM calls/min)
- Configurable models via environment variables

### 3.4 AI Validation Rule Engine
- Create custom validation rules with natural language prompt templates
- Configurable threshold (0–100) and weight (affects aggregate score)
- Global rules (admin-created, apply across all teams) and team-level rules
- Enable/disable rules per team
- Per-task rule selection (override which rules apply for a specific task)
- Role-based editing: managers cannot edit admin-authored global rules

### 3.5 Smart AI Conversational Assistant
- Conversational AI chat interface (streaming responses)
- **Native tool-calling** against live Supabase database (query submissions, tasks, rules, profiles, etc.)
- **RAG retrieval** — hybrid pgvector (semantic) + BM25 (full-text) with RRF fusion and keyword reranking
- Document upload directly into chat — files are parsed and indexed for conversation context
- Persistent chat threads with full history per user
- Per-user AI credit quota system with configurable period (daily/weekly/monthly)
- Rate limiting per user
- Capability gate — admin can revoke Smart AI access per user

### 3.6 In-App Messaging System
- Direct messages (1:1) between any two portal users
- Group conversations (multiple participants)
- **Real-time delivery** via Supabase Realtime (WebSocket)
- Typing indicators and presence detection
- Emoji reactions on messages (cross-client sync)
- Message replies (threaded context)
- Message edit and soft-delete
- File, image, audio, and video attachments via Cloudflare R2
- Per-conversation unread counts (`last_read_at`)
- Conversation hide/restore, group rename, group avatar
- Group admin management (promote/demote members)

### 3.7 Announcements
- Manager/admin can post team announcements with title, body, and priority level (low/normal/high/urgent)
- Optional expiry date — expired announcements auto-purge via cron
- Global announcements (admin) vs team-scoped (manager)
- Read/unread tracking

### 3.8 Materials Library
- Upload shared reference documents for team members
- Supported: all major file types up to 25 MB
- Metadata: title, description, tags
- Optional expiry — expired materials auto-deleted from DB + R2
- RAG-indexed for Smart AI retrieval

### 3.9 Team & Department Management
- Full CRUD for departments (teams)
- Assign and transfer team members between teams
- Manager assignment per team (one manager per team, enforced)
- Bulk operations for member assignment
- Statistics per team (member count, submission stats)

### 3.10 User Provisioning & Management
- Admin-only user provisioning (no public sign-up)
- Role assignment: main_admin / manager / member
- Team assignment at provisioning
- Force password reset on first login (`must_reset` flag)
- Soft delete (preserve audit history) with full session invalidation
- AI credit row auto-created on provisioning

### 3.11 AI Credit System
- Per-user monthly/weekly/daily AI usage quotas
- Atomic credit increment via Postgres RPC (race-condition safe)
- Main admins have unlimited credits by default
- Admin can set/override any user's quota and period type
- Usage dashboard with per-user consumption stats
- Credit auto-reset at period end

### 3.12 Reports & Analytics
- Dashboard home: KPI cards (submission count, pass rate, pending, score trends)
- Daily metrics charts via Recharts (submissions, scores)
- Per-team and per-member breakdowns
- 30-day trend visualization
- Pre-computed report snapshots table for efficient queries

### 3.13 Activity Log (Audit Trail)
- Append-only activity log on every system action
- Records: actor, team, action type, entity type/ID, metadata, IP address, user agent, timestamp
- Admin/manager can view full log with filters
- Actions logged: task created/updated/deleted, submission created/processed, rule created/updated/deleted, user provisioned/role changed/deleted, AI query, AI credits updated, messaging actions

### 3.14 Settings & Profile
- Update display name and avatar
- Change password
- Change email (with verification flow via Brevo)

### 3.15 Security Features
- Row-Level Security (RLS) on **every** database table
- Three-layer defense: Edge Proxy → Server Action → Postgres RLS
- All inputs validated with Zod
- Server-side rate limiting via Redis sliding window on: uploads, LLM calls, Smart AI chat, messaging sends
- Append-only audit trail
- Security headers: HSTS, CSP, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy
- `CRON_SECRET` authentication for scheduled endpoints
- `server-only` imports prevent service credentials from leaking client-side

### 3.16 Scheduled Background Jobs (Cron)
Railway HTTP cron every 15 minutes:
- **Mark missed** — submissions past `due_at` with no late policy marked as "missed"
- **Auto-fail stuck** — submissions stuck in processing for 5+ min recovered to "failed"
- **Expire announcements** — delete past `expires_at`, remove from RAG
- **Expire materials** — delete past `expires_at`, remove from R2, remove from RAG

---

## 4. Technical Architecture

### 4.1 High-Level Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Framework** | Next.js 16 (App Router), React 19 | RSC-first architecture, Server Actions, streaming |
| **UI Components** | shadcn/ui + Radix UI | Accessible, composable component library |
| **Styling** | Tailwind CSS 4 | Utility-first with design token system |
| **Database** | Self-hosted Supabase Postgres + pgvector | Relational DB + RLS + vector search |
| **Auth** | Self-hosted Supabase GoTrue | JWT sessions, provision-only, session invalidation |
| **Realtime** | Supabase Realtime (WebSocket) | Messaging delivery, assignment updates |
| **File Storage** | Cloudflare R2 (S3-compatible) | Submissions, materials, chat attachments, messaging attachments |
| **AI Validation** | OpenRouter → Gemini 2.0 Flash (Vercel AI SDK v6) | Rule evaluation, summaries, Vision OCR |
| **AI Chat** | OpenRouter → Claude Sonnet / GPT-4o-mini | Conversational AI with tool-calling |
| **Embeddings** | OpenAI text-embedding-3-small (1536-dim) | RAG document chunk indexing via pgvector HNSW |
| **Rate Limiting** | Railway Redis (ioredis) | Sliding-window rate limiters + idempotency locks |
| **Email** | Brevo (Sendinblue) | Welcome emails, email-change verification |
| **Deployment** | Railway | Single project: Next.js app + entire self-hosted Supabase stack |

### 4.2 System Architecture Diagram

```
Browser (React 19 RSC + Client Components)
         │
         │ HTTPS + WebSocket (Realtime)
         ▼
┌─────────────────────────────────────────────────┐
│          Railway — manager-portal (Next.js 16)   │
│                                                  │
│  Edge Proxy (session refresh, auth redirect)     │
│  App Router (RSC pages, Server Actions, APIs)    │
│  In-process AI validation pipeline               │
│  Native Smart AI (chat, RAG, analytics)          │
│  Messaging API (REST + Realtime broker)          │
└──────┬───────────┬──────────┬────────────────────┘
       │           │          │           │
       ▼           ▼          ▼           ▼
 Self-hosted   Railway    Cloudflare   OpenRouter
 Supabase      Redis      R2           (Gemini,
 (same         (rate      (files,      Claude,
  Railway       limits,    storage)    GPT-4o)
  project)      locks)
       │
  ┌────┴─────────────────────┐
  │ Postgres + RLS + pgvector│
  │ GoTrue Auth              │
  │ Realtime (WebSocket)     │
  │ PostgREST + Kong gateway │
  └──────────────────────────┘
```

### 4.3 Application Module Map

```
app/
├── auth/                    ← Login, forgot-password, email-change, callback
├── (dashboard)/dashboard/
│   ├── page.tsx             ← Home KPI dashboard
│   ├── submissions/         ← Submission management
│   ├── tasks/               ← Task management + assignment
│   ├── rules/               ← AI validation rule editor
│   ├── team/                ← Team member management
│   ├── departments/         ← Organization-wide department management (admin)
│   ├── announcements/       ← Announcements
│   ├── materials/           ← Materials library
│   ├── smart-ai/            ← Smart AI chat portal (streaming + RAG)
│   ├── messages/            ← DMs and group conversations (realtime)
│   ├── ai-usage/            ← AI credit dashboard (admin)
│   ├── activity/            ← Audit log
│   ├── reports/             ← Analytics + metric snapshots
│   └── settings/            ← Profile, password, email
├── actions/                 ← Server Actions (all mutations)
└── api/
    ├── smart-ai/            ← chat (streaming), upload, threads, analytics
    ├── messaging/           ← conversations, messages, presence, typing, upload
    ├── pipeline/[id]/       ← AI validation trigger + status polling
    ├── cron/mark-missed/    ← Scheduled background jobs entry point
    ├── ai-credits/me/       ← Credit quota check
    └── download/[id]/       ← RLS-checked R2 file streaming proxy
```

---

## 5. Database Schema Overview

### Key Tables (24 total)

| Table | Purpose |
|-------|---------|
| `profiles` | Users with roles, team, must_reset, soft-delete, avatar |
| `teams` | Organizational units with designated manager |
| `tasks` | Work items: deadlines, late policy, rule_ids, AI brief |
| `task_assignments` | Per-member task instances with status mirror |
| `submissions` | Uploaded files with AI validation results, score, summary, flags |
| `validation_rules` | Per-team LLM prompts with threshold, weight, global flag |
| `validation_runs` | Per-rule-per-submission scoring records (score, pass, reasons, flags, tokens) |
| `rag_documents` | pgvector + tsvector indexed chunks for Smart AI retrieval |
| `chat_threads` | Smart AI conversation sessions |
| `chat_messages` | Smart AI message history |
| `chat_documents` | Files uploaded inside Smart AI chat |
| `ai_credit_limits` | Per-user quota config (period type, limit, is_unlimited) |
| `ai_usage_log` | Per-event AI usage ledger (model, tokens, thread) |
| `conversations` | Messaging containers (DM / group) |
| `conversation_members` | Many-to-many: user ↔ conversation with role, last_read_at |
| `messages` | Message bodies with reply_to, soft-delete, media_url, metadata |
| `message_reactions` | Emoji reactions per message per user |
| `announcements` | Team/global announcements with priority and expiry |
| `materials` | Shared reference files with tags and expiry |
| `activity_log` | Immutable append-only audit trail |
| `report_snapshots` | Pre-computed analytics rollups |

### Database Features Used
- **Row-Level Security (RLS)** on every table
- **pgvector** (HNSW index, 1536-dim) for RAG semantic search
- **tsvector** full-text search columns alongside pgvector
- **RPC functions**: `assign_task_to_team`, `increment_ai_usage`, `maybe_reset_period`, `invalidate_user_sessions`, `find_dm_conversation`, hybrid retrieval with RRF fusion
- **44 incremental SQL migration files** (plus 9 foundational scripts)

---

## 6. AI Subsystem Details

### 6.1 Document Validation Pipeline
- Runs **in-process** (no separate worker service needed)
- Fire-and-forget async from Server Action
- Crash recovery via cron sweep
- Supports 7+ file formats via specialized parsers
- Each validation rule is a natural-language prompt with configurable threshold and weight
- Returns: score (0–100), pass/fail, structured reasons array, flag categories
- Summaries include: executive summary, topic extraction, predictive risk flags

### 6.2 Smart AI Assistant
- Streaming chat (Server-Sent Events)
- Up to 10 tool-calling steps per query
- Tools: `query_database` (Supabase), `get_submission_details`, `search_rag`, `list_tasks`, etc.
- Hybrid RAG: pgvector cosine similarity + BM25 full-text + RRF fusion + keyword reranker
- Sliding-window token management to stay within context limits
- Chat thread persistence (per-user history)

### 6.3 Models Used

| Model | Provider | Use Case |
|-------|----------|---------|
| `google/gemini-2.0-flash-001` | OpenRouter | Validation rules + summaries + Vision OCR |
| `anthropic/claude-sonnet-4-5` | OpenRouter | Smart AI chat (configurable via env var) |
| `openai/text-embedding-3-small` | OpenAI | 1536-dim embeddings for pgvector |

All models are **env-var configurable** — no code change needed to swap models.

---

## 7. Deployment & Infrastructure

### Current Production Deployment

| Service | Platform |
|---------|---------|
| Next.js app | Railway (standalone Node.js container via Railpack) |
| Postgres database | Railway (self-hosted Supabase) |
| Auth (GoTrue) | Railway (self-hosted Supabase) |
| Realtime | Railway (self-hosted Supabase) |
| PostgREST + Kong gateway | Railway (self-hosted Supabase) |
| Redis | Railway (native Redis service) |
| File storage | Cloudflare R2 |
| Email | Brevo |
| CDN / WAF | Cloudflare |

### Infrastructure Notes
- **Single Railway project** contains the Next.js app and the entire self-hosted Supabase stack
- Production domain: `system.zamdevai.com` behind Cloudflare proxy
- Cloudflare WAF rules block traffic not hitting the canonical domain
- Security headers enforced at Next.js level (HSTS 2yr, CSP, etc.)
- Cron: Railway HTTP cron hitting `/api/cron/mark-missed` every 15 minutes

---

## 8. Scale & Complexity Indicators

For software houses estimating rebuild cost:

| Indicator | Count / Detail |
|-----------|---------------|
| Dashboard pages/routes | 14 distinct routes |
| API route groups | 8 groups (20+ individual routes) |
| Server Actions | ~50 exported action functions across 10 files |
| Database tables | 21 tables + RLS on all |
| SQL migration files | 44 incremental + 9 foundational = 53 total |
| AI models integrated | 3 models (validation, chat, embeddings) |
| Real-time subscriptions | 3 (messages, reactions, conversation_members) |
| UI component files | 80+ in `components/` |
| TypeScript files total | 200+ |
| Document parsing formats | 7 (PDF, DOCX, PPTX, XLSX, PNG, JPEG, text/MD) |
| Role types | 3 (main_admin, manager, member) with granular capability system |
| Redis rate limiters | 5 (upload, LLM, Smart AI chat, messaging, pipeline lock) |
| Background jobs | 4 (mark-missed, auto-fail stuck, expire announcements, expire materials) |

---

## 9. What a Software House Would Need to Build to Replicate This

A software house building this from scratch would need:

### Engineering expertise required
- **Next.js 16 App Router** (RSC, Server Actions, streaming)
- **Supabase** (self-hosted: Postgres, GoTrue, Realtime, PostgREST, Kong)
- **PostgreSQL advanced** (RLS, RPCs, pgvector, tsvector, HNSW indexes)
- **AI/LLM integration** (OpenRouter, Vercel AI SDK v6, streaming, tool-calling, RAG)
- **Vector search** (pgvector, BM25, RRF fusion, embedding pipelines)
- **Real-time systems** (WebSocket, Supabase Realtime, optimistic UI)
- **File processing** (PDF parsing, DOCX/PPTX/XLSX extraction, Vision OCR via Gemini)
- **Cloud storage** (Cloudflare R2 / S3 API, private access patterns, presigned URLs)
- **Redis** (ioredis, sliding window rate limiting, idempotency locks)
- **Infrastructure** (Railway, self-hosted Supabase, Docker-compatible deployment)
- **Security** (multi-layer auth, RLS, CSP headers, audit trails, session management)
- **Email** (Brevo transactional email, email-change verification flows)

### Estimated build time (from scratch, professional team)
| Stage | Estimated Duration |
|-------|-------------------|
| Core auth, roles, teams, users | 4–6 weeks |
| Task management + assignment | 3–4 weeks |
| Document submission + storage | 2–3 weeks |
| AI validation pipeline | 4–6 weeks |
| Smart AI + RAG subsystem | 6–8 weeks |
| Messaging subsystem | 5–7 weeks |
| Announcements + materials | 2–3 weeks |
| Reports + analytics | 2–3 weeks |
| Security hardening + RLS | 3–4 weeks |
| Cron jobs + background work | 1–2 weeks |
| AI credit system | 1–2 weeks |
| Deployment + infra + testing | 3–5 weeks |
| **Total estimate** | **~36–53 weeks** (9–13 months) with a team of 2–3 engineers |

---

## 10. Summary for Software House

We are requesting a **price estimation** for this software system based on the scope above. Specifically we want to understand:

1. What would it cost your team to **build this from scratch** (full rebuild)?
2. What would it cost to **add to or customize** an existing system like this (enhancement/customization)?
3. What would a **monthly maintenance/support retainer** look like for a system of this complexity?
4. What is your team's **timeline estimate** for building this?

Please base your estimate on:
- The 14 dashboard modules described
- The AI validation pipeline with 7-format document parsing
- The Smart AI assistant with RAG and live database tool-calling
- The real-time messaging subsystem
- The security/audit/compliance layer
- Self-hosted Supabase + Railway infrastructure

---

*Prepared by JobFlowAI Engineering — May 2026*  
*This document is confidential and prepared for estimation purposes only.*
