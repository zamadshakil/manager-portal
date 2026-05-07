# Hierarchia Manager Portal — Documentation Index

Complete guide to all project documentation and resources.

---

## 🚀 Quick Navigation

### For New Developers
Start here if you're setting up the project for the first time:

1. **[QUICK_START.md](./QUICK_START.md)** (5 min)
   - Prerequisites (Node 22+, Railway credentials)
   - 4-step local setup
   - Common commands & troubleshooting

2. **[README.md](./README.md)** (10 min)
   - Project overview & tech stack
   - Railway infrastructure diagram
   - Project structure (app/, lib/, supabase/)
   - Key features & environment variables

3. **[docs/PROJECT_STATUS.md](./docs/PROJECT_STATUS.md)** (20 min)
   - Complete architecture & data model
   - Security design (3-layer auth)
   - Module dependencies
   - End-to-end request traces

### For Smart AI / RAG Development
If you're working on the AI assistant or RAG pipeline:

1. **[docs/SMART_AI_AUDIT.md](./docs/SMART_AI_AUDIT.md)** ⭐ START HERE
   - Full audit of Smart AI, MCP, and RAG subsystems
   - Schema/code alignment status
   - AI SDK v6 migration details
   - Attachment metadata wiring
   - Operator runbook (§13)

2. **[supabase/migrations/20260505_rag_documents.sql](./supabase/migrations/20260505_rag_documents.sql)**
   - pgvector table + HNSW index
   - Vector similarity search RPC (`search_rag_vector`)
   - BM25 full-text search RPC (`search_rag_bm25`)
   - RLS policies for RAG documents

### For Code Review
If you're reviewing code quality or implementation details:

1. **[docs/CODEBASE_AUDIT.md](./docs/CODEBASE_AUDIT.md)**
   - Comprehensive code quality audit
   - Quality metrics & security assessment
   - Recommendations

2. **[docs/AUDIT_SUMMARY.md](./docs/AUDIT_SUMMARY.md)**
   - Executive audit summary & scorecard

3. **[docs/IMPLEMENTATION_CHANGES.md](./docs/IMPLEMENTATION_CHANGES.md)**
   - Detailed changelog of audit fixes

### For Deployment & Operations
If you're deploying or managing the production system:

1. **[DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md)** — Railway deployment guide
2. **[.env.local.example](./.env.local.example)** — Complete environment variable template
3. **[railway.json](./railway.json)** — Railway build & deploy configuration

---

## 📚 Complete Documentation Map

### Root-Level Guides

| File | Purpose |
|------|---------|
| [README.md](./README.md) | Project overview, tech stack, Railway infrastructure, getting started |
| [QUICK_START.md](./QUICK_START.md) | 4-minute local setup guide |
| [DOCUMENTATION.md](./DOCUMENTATION.md) | This file — documentation index |
| [DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md) | Deployment verification & testing |
| [FIXES_COMPLETED.md](./FIXES_COMPLETED.md) | Historical: April 2026 audit fixes |

### Core Documentation (docs/ folder)

| File | Purpose |
|------|---------|
| [docs/PROJECT_STATUS.md](./docs/PROJECT_STATUS.md) | Complete architecture, data model, security design |
| [docs/SMART_AI_AUDIT.md](./docs/SMART_AI_AUDIT.md) | Smart AI / MCP / RAG subsystem audit (838 lines) |
| [docs/CODEBASE_AUDIT.md](./docs/CODEBASE_AUDIT.md) | Code quality audit |
| [docs/AUDIT_SUMMARY.md](./docs/AUDIT_SUMMARY.md) | Executive audit scorecard |
| [docs/IMPLEMENTATION_CHANGES.md](./docs/IMPLEMENTATION_CHANGES.md) | Detailed fix changelog |
| [docs/IMPLEMENTATION_SUMMARY.md](./docs/IMPLEMENTATION_SUMMARY.md) | Implementation summary |
| [docs/ARCHITECTURE_DIAGRAM.md](./docs/ARCHITECTURE_DIAGRAM.md) | Visual system architecture |
| [docs/TASK_TEAM_MANAGEMENT_AUDIT.md](./docs/TASK_TEAM_MANAGEMENT_AUDIT.md) | Task & team management audit |

### Configuration Files

| File | Purpose |
|------|---------|
| [.env.local.example](./.env.local.example) | Full env var template with Railway/Kong/R2 docs |
| [railway.json](./railway.json) | Railway Railpack build + standalone deploy config |
| [next.config.mjs](./next.config.mjs) | Security headers, CSP, standalone output, body limits |
| [tailwind.config.ts](./tailwind.config.ts) | Design token configuration |
| [package.json](./package.json) | Dependencies (Node ≥22, Next 16, AI SDK v6, pgvector) |

> **Decommissioned:** The `mcp-service/` and `rag-service/` directories
> (and their corresponding Railway deployments) have been removed. All
> Smart AI orchestration now runs natively inside `manager-portal` —
> see [`lib/smart-ai/`](./lib/smart-ai/) and
> [`app/api/smart-ai/`](./app/api/smart-ai/). The historical audit docs
> in [`docs/`](./docs/) still reference those services as a record of
> the previous architecture.

---

## 🎯 Documentation by Topic

### Architecture & Design
- [README.md#railway-infrastructure](./README.md#railway-infrastructure) — Service topology
- [docs/PROJECT_STATUS.md](./docs/PROJECT_STATUS.md) — Complete specification
- [docs/ARCHITECTURE_DIAGRAM.md](./docs/ARCHITECTURE_DIAGRAM.md) — Visual diagrams

### Smart AI / RAG
- [docs/SMART_AI_AUDIT.md](./docs/SMART_AI_AUDIT.md) — Full subsystem audit
- [lib/smart-ai/](./lib/smart-ai/) — Indexer, retriever, reranker, client, sliding-window
- [supabase/migrations/20260505_rag_documents.sql](./supabase/migrations/20260505_rag_documents.sql) — pgvector schema

### AI Validation Pipeline
- [lib/pipeline/process.ts](./lib/pipeline/process.ts) — In-process async pipeline runner
- [lib/llm/pipeline.ts](./lib/llm/pipeline.ts) — Pipeline orchestrator with idempotency + budget management
- [lib/llm/validate.ts](./lib/llm/validate.ts) — Rule runner + summariser + vision (Gemini 2.0 Flash)
- [lib/parse/](./lib/parse/) — Document parsers (PDF via unpdf, DOCX, PPTX, images via Gemini Vision)

### Security
- [docs/PROJECT_STATUS.md#3-roles-rls](./docs/PROJECT_STATUS.md#3-roles-rls-and-the-principle-of-defence-in-depth) — 3-layer defense
- [next.config.mjs](./next.config.mjs) — CSP, HSTS, security headers
- [lib/auth.ts](./lib/auth.ts) — `requireProfile`, `requireRole`, `canManageTeam`

### Deployment & Operations
- [README.md#deployment](./README.md#deployment) — Railway deployment
- [DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md) — Verification
- [railway.json](./railway.json) — Build configuration

### Data Model
- [docs/PROJECT_STATUS.md#4-data-model](./docs/PROJECT_STATUS.md#4-data-model) — Complete schema
- [scripts/](./scripts/) — SQL migration files (001–009)
- [supabase/migrations/](./supabase/migrations/) — RAG + chat + AI credits schema

### Design System & Styling
- [tailwind.config.ts](./tailwind.config.ts) — Tailwind token configuration
- [app/globals.css](./app/globals.css) — CSS custom properties

---

## 🔄 Documentation Maintenance

### When to Update Documentation

**Update immediately:**
- New services or microservices added to Railway
- Database schema changes (new tables, columns, migrations)
- New environment variables
- Security-relevant changes
- Breaking API changes

**Update regularly:**
- [docs/PROJECT_STATUS.md](./docs/PROJECT_STATUS.md) — After major features
- [README.md](./README.md) — Tech stack or infrastructure changes
- [.env.local.example](./.env.local.example) — New env vars

### Documentation Standards

All documentation should include:
- Clear section headings (h2-h4)
- Links to related docs and source files
- Code examples where relevant
- "Last Updated" dates on specifications

---

## 🎓 Learning Path

### Day 1 (Setup)
1. [QUICK_START.md](./QUICK_START.md) — Get it running (5 min)
2. [README.md](./README.md) — Understand the project (10 min)
3. Explore the app in browser — login, tasks, Smart AI

### Day 2-3 (Architecture)
1. [docs/PROJECT_STATUS.md](./docs/PROJECT_STATUS.md) — Full specification (30 min)
2. Read through key source files:
   - `app/layout.tsx` — Root layout
   - `app/actions/` — Server actions pattern
   - `lib/supabase/` — Database clients
   - `lib/pipeline/process.ts` — In-process async pipeline
   - `lib/llm/pipeline.ts` — Pipeline orchestrator
3. Trace one end-to-end flow (create task → assign → submit → validate)

### Week 1-2 (Deep Dive)
1. [docs/SMART_AI_AUDIT.md](./docs/SMART_AI_AUDIT.md) — Smart AI subsystem (30 min)
2. Study the validation pipeline:
   - [lib/llm/pipeline.ts](./lib/llm/pipeline.ts) — Orchestrator
   - [lib/llm/validate.ts](./lib/llm/validate.ts) — LLM validation
3. Study the RAG system:
   - [lib/smart-ai/indexer.ts](./lib/smart-ai/indexer.ts) — Document indexing
   - [lib/smart-ai/retriever.ts](./lib/smart-ai/retriever.ts) — Hybrid retrieval
4. Review database schema: [scripts/001_init_schema.sql](./scripts/001_init_schema.sql)

---

## 📞 Getting Help

1. **Setup issues** → [QUICK_START.md#troubleshooting](./QUICK_START.md#troubleshooting)
2. **Architecture questions** → [docs/PROJECT_STATUS.md](./docs/PROJECT_STATUS.md)
3. **Smart AI / RAG** → [docs/SMART_AI_AUDIT.md](./docs/SMART_AI_AUDIT.md)
4. **Code quality** → [docs/CODEBASE_AUDIT.md](./docs/CODEBASE_AUDIT.md)
5. **Deployment** → [DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md)

---

**Last Updated:** May 7, 2026
**Status:** All documentation updated to reflect current codebase
