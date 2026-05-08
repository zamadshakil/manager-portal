# Presentation Guide & Talking Points

> **Client Delivery Document** | Part 6 of 6 | Version 2.0 | May 8, 2026

---

## 1. Recommended Demo Flow (20–25 minutes)

### Opening (2 min)
> "Hierarchia is an AI-powered manager portal that automates document review, gives every manager a chat-based copilot over their own data, and adds team-wide messaging — all in one product. Instead of managers reading and scoring every submission, our AI pipeline parses, validates, scores, and summarises documents in under 60 seconds. Then the Smart AI assistant lets them ask questions about that data conversationally."

**Key stats to highlight:**
- Handles PDF, DOCX, PPTX, XLSX, images, and plain text up to 25 MB — with zero manual intervention.
- The Smart AI assistant runs over a native pgvector RAG store, so retrieval stays inside the same database that holds your operational data.

---

### Demo Step 1: Admin Setup (3 min)
1. Log in as **Main Admin**
2. Show the **Departments** page — create a team
3. **Provision a user** — show temporary password flow
4. Assign a **manager** to the team
5. **Talking point:** *"The admin sets up the organizational structure once. After that, managers run their teams independently."*

### Demo Step 2: Manager Configures Rules (3 min)
1. Switch to **Manager** account
2. Navigate to **Rules** page
3. Create a validation rule:
   - Name: "Professional Formatting"
   - Prompt: "Check if the document has proper headings, grammar, and professional tone"
   - Threshold: 75
   - Weight: 1.5
4. **Talking point:** *"Rules are fully customizable. The AI prompt, pass threshold, and weight are all configurable per team. No code changes needed."*

### Demo Step 3: Create & Assign a Task (2 min)
1. Go to **Tasks** page
2. Create a task with:
   - Title, description, AI instructions
   - A deadline
   - Late policy (allow with reason)
   - Select which rules to apply
   - Assign to all members or specific ones
3. **Talking point:** *"Each task can have its own AI validation criteria. The manager controls exactly what the AI checks for."*

### Demo Step 4: Member Submits (3 min)
1. Switch to **Member** account
2. Show "My Tasks" — see assigned task with deadline
3. Upload a document
4. Watch the status progression: `queued → parsing → validating → passed`
5. View results: score, summary, flags, per-rule breakdown
6. **Talking point:** *"The entire validation happens in the background. The member uploads and sees results within a minute — no waiting for manual review."*

### Demo Step 5: Dashboard & Analytics (2 min)
1. Switch back to **Manager**
2. Show **Dashboard Home**: KPI cards, 30-day trend chart
3. Show **Submissions** list with filters
4. Open a submission detail: AI summary, flags, extracted text
5. **Talking point:** *"Managers get complete visibility — pass rates, average scores, daily trends — all updating in real time."*

### Demo Step 6: Smart AI Assistant (3 min)
1. Open **Smart AI** in the sidebar
2. Ask: *"How many submissions failed in the last week, grouped by team?"* — the assistant calls `queryDatabase` live
3. Drag in a PDF and ask a question about it — it gets indexed into pgvector and answered with citations
4. Open the **AI Usage** page to show per-user credit accounting
5. **Talking point:** *"Smart AI sees only what RLS lets the user see. It can answer operational questions in seconds and ground responses in your own documents."*

### Demo Step 7: Messaging (2 min)
1. Open **Messages** in the sidebar
2. Start a DM with another portal user; in a second window, send a message back — it appears in real time
3. Create a group conversation, attach an image, react to a message, reply in-thread
4. **Talking point:** *"Messaging is built on Supabase Realtime over RLS-protected tables. Every conversation is private to its members — there is no admin back-door."*

### Demo Step 8: Security & Audit (2 min)
1. Show **Activity Log** — every action tracked
2. Mention the 3-layer security model (middleware → server action → RLS)
3. Show that members cannot access manager pages
4. **Talking point:** *"Enterprise-grade defense in depth. Every action is logged with full attribution."*

---

## 2. Key Value Propositions

### For the C-Suite
| Point | Message |
|-------|---------|
| **Cost Reduction** | Eliminates manual document review labour. AI processes submissions in under 60 seconds; the Smart AI copilot answers ad-hoc reporting questions on demand. |
| **Consistency** | Every document is evaluated against the same criteria. No human bias or fatigue. |
| **Scalability** | Handles unlimited teams, members, and submissions. Railway scales the entire stack horizontally. |
| **Compliance** | Full audit trail with IP logging. RLS ensures data isolation between teams — enforced at the database, not just the UI. |
| **Modern Stack** | Built with industry-leading technologies (Next.js 16, React 19, PostgreSQL + pgvector, Supabase Realtime). |

### For IT / Technical Teams
| Point | Message |
|-------|---------|
| **Self-contained Hosting** | The entire backend (Next.js + self-hosted Supabase + Redis) lives in a single Railway project — no Vercel / Inngest / DigitalOcean dependencies. |
| **3-Layer Security** | Middleware → Server Action → Postgres RLS. Defense in depth, with `server-only` imports preventing service-role leakage at build time. |
| **Provider Flexibility** | OpenRouter front-ends every LLM call. Models are configurable via env vars (Gemini, GPT-4o, Claude, local models, etc.) — no SDK rewrite needed to switch. |
| **Crash-resilient pipeline** | The in-process pipeline uses Redis idempotency locks; the cron sweep recovers anything stuck for >5 minutes. |
| **Native RAG** | pgvector + BM25 + RRF fusion in the same database as your operational data — no separate vector store to maintain. |
| **Observable** | Every pipeline run records latency, model, prompt version, token usage. AI credit usage tracked per user. |

### For End Users (Managers & Members)
| Point | Message |
|-------|---------|
| **Instant Feedback** | Upload and get AI-scored results in under a minute. |
| **Custom Rules** | Managers define exactly what the AI evaluates — no generic scoring. |
| **Deadline Management** | Automatic deadline enforcement with configurable late policies. |
| **Smart AI Copilot** | Ask plain-English questions about submissions, tasks, or uploaded documents — get streamed answers with citations. |
| **In-app Messaging** | DMs and group chats with realtime delivery, reactions, replies, and attachments — no need to bounce to Slack/Teams. |
| **Mobile Responsive** | Full mobile navigation with bottom nav bar. |
| **Clean UI** | Notion-inspired design with light/dark mode support. |

---

## 3. Technical Differentiators

### Why This Architecture Stands Out

1. **React Server Components** — Pages load fast because heavy data fetching happens on the server, not in the browser. Zero client-side loading spinners for data.

2. **In-process AI pipeline with idempotency** — Each submission is processed by a fire-and-forget async function with a Redis `SETNX` lock so retries can never double-process. The cron sweep recovers anything stuck for more than 5 minutes — cheaper than a worker fleet, just as resilient.

3. **Per-Task Rule Selection** — Tasks can specify exactly which validation rules apply. A "Code Review" task checks different things than a "Financial Report" task, even in the same team.

4. **Weighted Scoring** — Rules have configurable weights. A "Critical Compliance" rule with weight 3 has triple the impact of a "Formatting" rule with weight 1. This produces nuanced, meaningful scores.

5. **Vision OCR via Gemini** — Image submissions (photos of handwritten documents, scanned PDFs) are processed via the same Gemini 2.0 Flash model used for text validation. One provider, one billing line, full real-world document support.

6. **Predictive Flags** — The AI doesn't just score — it generates predictive risk flags ("Missing financial projections", "No conclusion section") that help managers prioritise what to review.

7. **Native pgvector RAG** — Smart AI retrieval is hybrid (vector ANN + BM25 full-text, fused with Reciprocal Rank Fusion and reranked by keyword overlap), and lives in the same Postgres as your operational data. No separate vector database, no replication lag.

8. **Realtime messaging on RLS** — The messaging subsystem uses Supabase Realtime over the RLS-protected `messages` table. Server enforcement — not client trust — keeps conversations private.

---

## 4. Frequently Asked Questions

### Product Questions

**Q: How accurate is the AI validation?**
> The default validation, summarisation, and vision models are all Gemini 2.0 Flash via OpenRouter. Accuracy depends on how well the validation rules are written — specific, clear prompts produce the best results. The system also supports adjustable thresholds (0-100) and per-rule weights so managers can tune sensitivity.

**Q: What file types are supported?**
> PDF, DOCX, PPTX, XLSX, PNG, JPEG, and plain text / Markdown. Maximum file size is 25 MB. Scanned PDFs and photos are routed through Gemini Vision OCR automatically.

**Q: Can we add more AI models?**
> Yes. Every model is configurable via environment variables (`SMART_AI_MODEL`, `DO_VALIDATION_MODEL`, `DO_SUMMARY_MODEL`, `DO_VISION_MODEL`, `EMBEDDING_MODEL`). OpenRouter routes to OpenAI, Anthropic, Google, Groq, Mistral and local models with the same OpenAI-compatible API.

**Q: What happens if the AI is unavailable?**
> Submissions are marked `needs_review` so managers can review them manually. The Railway cron job (every 15 minutes) also recovers any submission stuck in processing for more than 5 minutes.

### Technical Questions

**Q: Where is data stored?**
> Self-hosted Supabase Postgres on Railway. Files stored on Cloudflare R2 (S3-compatible). All data encrypted at rest and in transit.

**Q: Is there vendor lock-in?**
> Minimal. Supabase is open-source PostgreSQL. R2 speaks the S3 API — swap for any S3-compatible bucket. Every LLM call goes through OpenRouter, which itself is OpenAI-API compatible. Next.js standalone builds run anywhere Node 22 runs.

**Q: Can this handle high traffic?**
> Yes. Railway scales each service horizontally. Postgres connection pooling handles concurrent queries; pgvector with HNSW handles vector search at scale. Sliding-window rate limiting prevents abuse. The architecture has no fixed-capacity bottlenecks.

**Q: How is the database backed up?**
> Railway Postgres supports automated backups; configure schedule and retention in the Railway dashboard. Point-in-time recovery is available on supported plans.

---

## 5. Design System Overview

### Design Philosophy
- **Notion-inspired** warm neutral palette
- **Light + Dark mode** via CSS custom properties
- **Typography**: Inter (body), JetBrains Mono (code)
- **Component Library**: shadcn/ui (50+ accessible components)
- **Icons**: Lucide React (tree-shaken, only used icons bundled)

### Color System
| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--primary` | `#0075de` | `#097fe8` | Buttons, links, active states |
| `--background` | `#ffffff` | `#1f1e1c` | Page background |
| `--foreground` | `rgba(0,0,0,0.95)` | `rgba(255,255,255,0.95)` | Text |
| `--muted` | `#f6f5f4` | `#31302e` | Subtle backgrounds |
| `--destructive` | `#dd5b00` | `#dd5b00` | Error states, delete actions |
| `--success` | `#1aae39` | `#1aae39` | Pass status, positive states |

---

## 6. File Inventory (Key Source Areas)

| Path | Purpose |
|------|---------|
| `lib/llm/pipeline.ts` | AI validation pipeline orchestrator |
| `lib/llm/validate.ts` | OpenRouter calls (rules, summary, vision) via Vercel AI SDK |
| `lib/pipeline/process.ts` | In-process async submission processor with idempotency lock |
| `lib/parse/index.ts` | Document text extraction (unpdf, mammoth, officeparser, vision OCR) |
| `lib/data.ts` | All database read queries (single source of truth) |
| `lib/types.ts` | TypeScript type definitions |
| `lib/auth.ts` / `auth-shared.ts` | Cached auth helpers + role guards |
| `lib/redis.ts` | Railway-native ioredis client + sliding-window rate limiters |
| `lib/r2.ts` | Cloudflare R2 (S3 API) client |
| `lib/email.ts` | Brevo transactional email integration |
| `lib/smart-ai/{indexer,retriever,reranker,client,bootstrap,pg-client}.ts` | Native RAG + Smart AI orchestration |
| `lib/supabase/{server,admin,client,proxy}.ts` | Supabase clients for every runtime |
| `app/actions/*.ts` | Server actions (submissions, tasks, rules, users, materials, announcements, departments, profile, ai-credits, auth) |
| `app/api/smart-ai/*` | Smart AI endpoints (chat, upload, threads, analytics, health, bootstrap) |
| `app/api/messaging/*` | Messaging endpoints (conversations, messages, presence, typing, upload) |
| `app/api/cron/mark-missed/route.ts` | Railway HTTP cron entry point |
| `app/api/download/[id]/route.ts` | RLS-checked R2 streaming proxy |
| `app/(dashboard)/dashboard/*` | All authenticated routes (12 pages) |
| `components/dashboard/*` | Dashboard UI — incl. `smart-ai/`, `messaging/`, `ai-usage/` |
| `hooks/use-conversation-realtime.ts` | Supabase Realtime subscription for messaging |
| `scripts/*.sql` | Foundational migrations (001–007 + Smart AI chat schema) |
| `supabase/migrations/*.sql` | Incremental migrations (RAG, AI credits, email-change, messaging) |
| `next.config.mjs` | Security headers + standalone output + Server-Action body limit |
| `proxy.ts` | Edge auth middleware entry point |
| `railway.json` | Railway build + deploy configuration |

---

## 7. Documentation Package Contents

This delivery includes the following documentation:

| # | Document | Focus |
|---|----------|-------|
| 01 | [Executive Overview](./01_EXECUTIVE_OVERVIEW.md) | What the product does, features, roles |
| 02 | [Technical Architecture](./02_TECHNICAL_ARCHITECTURE.md) | System design, database schema, security layers |
| 03 | [Glossary of Terms](./03_GLOSSARY.md) | Every term and technology explained |
| 04 | [Data Flows & User Journeys](./04_DATA_FLOWS.md) | Step-by-step flows for all operations |
| 05 | [Deployment Guide](./05_DEPLOYMENT_GUIDE.md) | Environment setup, Vercel deployment, security |
| 06 | [Presentation Guide](./06_PRESENTATION_GUIDE.md) | Demo script, talking points, FAQ (this file) |

### Additional Codebase Documentation
| Document | Location |
|----------|----------|
| README | `./README.md` |
| Quick Start | `./QUICK_START.md` |
| Documentation Index | `./DOCUMENTATION.md` |
| Project Status & Spec | `./docs/PROJECT_STATUS.md` |
| Codebase Audit | `./docs/CODEBASE_AUDIT.md` |
| Architecture Diagrams | `./docs/ARCHITECTURE_DIAGRAM.md` |

---

> **Prepared by JobFlowAI Engineering — May 8, 2026**
> 
> *Hierarchia Manager Portal — Production Ready*
