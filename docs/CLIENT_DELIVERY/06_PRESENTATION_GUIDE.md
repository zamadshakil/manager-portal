# Presentation Guide & Talking Points

> **Client Delivery Document** | Part 6 of 6

---

## 1. Recommended Demo Flow (15–20 minutes)

### Opening (2 min)
> "Hierarchia is an AI-powered document management platform that automates the review process. Instead of managers manually reading and scoring every submission, our AI pipeline parses, validates, scores, and summarizes documents in under 60 seconds."

**Key stat to highlight:** The system handles PDF, DOCX, PPTX, and image files up to 25 MB with zero manual intervention.

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

### Demo Step 6: Security & Audit (2 min)
1. Show **Activity Log** — every action tracked
2. Mention the 4-layer security model
3. Show that members cannot access manager pages
4. **Talking point:** *"Enterprise-grade security with four layers of defense. Every action is logged with full attribution."*

---

## 2. Key Value Propositions

### For the C-Suite
| Point | Message |
|-------|---------|
| **Cost Reduction** | Eliminates manual document review labor. AI processes submissions in under 60 seconds. |
| **Consistency** | Every document is evaluated against the same criteria. No human bias or fatigue. |
| **Scalability** | Handles unlimited teams, members, and submissions. Infrastructure scales automatically. |
| **Compliance** | Full audit trail with IP logging. RLS ensures data isolation between teams. |
| **Modern Stack** | Built with industry-leading technologies (Next.js 16, React 19, PostgreSQL). |

### For IT / Technical Teams
| Point | Message |
|-------|---------|
| **Zero Infrastructure** | Fully serverless — no servers to manage, patch, or scale. |
| **4-Layer Security** | Edge → Route → Action → Database security. Defense in depth. |
| **Open AI Models** | Uses open-source DeepSeek V3 — no vendor lock-in to OpenAI/Anthropic. |
| **Durable Jobs** | Inngest ensures pipeline never loses work, even on failures. |
| **Observable** | Every pipeline run records latency, model, prompt version, token usage. |

### For End Users (Managers & Members)
| Point | Message |
|-------|---------|
| **Instant Feedback** | Upload and get AI-scored results in under a minute. |
| **Custom Rules** | Managers define exactly what the AI evaluates — no generic scoring. |
| **Deadline Management** | Automatic deadline enforcement with configurable late policies. |
| **Mobile Responsive** | Full mobile navigation with bottom nav bar. |
| **Clean UI** | Notion-inspired design with light/dark mode support. |

---

## 3. Technical Differentiators

### Why This Architecture Stands Out

1. **React Server Components** — Pages load fast because heavy data fetching happens on the server, not in the browser. Zero client-side loading spinners for data.

2. **Durable AI Pipeline (Inngest)** — Each validation rule runs as an independent step. If one rule fails, only that rule retries — the rest aren't affected. This is far more resilient than a monolithic pipeline.

3. **Per-Task Rule Selection** — Tasks can specify exactly which validation rules apply. A "Code Review" task checks different things than a "Financial Report" task, even in the same team.

4. **Weighted Scoring** — Rules have configurable weights. A "Critical Compliance" rule with weight 3 has triple the impact of a "Formatting" rule with weight 1. This produces nuanced, meaningful scores.

5. **Vision OCR** — Image submissions (photos of handwritten documents, scanned PDFs) are processed via a dedicated vision model. Not just text — the system handles the real-world document types people actually use.

6. **Predictive Flags** — The AI doesn't just score — it generates predictive risk flags ("Missing financial projections", "No conclusion section") that help managers prioritize what to review.

---

## 4. Frequently Asked Questions

### Product Questions

**Q: How accurate is the AI validation?**
> The AI uses DeepSeek V3, one of the highest-quality open models available. Accuracy depends on how well the validation rules are written — specific, clear prompts produce the best results. The system also supports adjustable thresholds (0-100) so managers can tune sensitivity.

**Q: What file types are supported?**
> PDF, DOCX (Word), PPTX (PowerPoint), PNG, and JPEG. Maximum file size is 25 MB.

**Q: Can we add more AI models?**
> Yes. The model is configurable via environment variables. The system uses the OpenAI-compatible API format, so any provider with that interface (OpenAI, Groq, Anthropic, local models) can be swapped in.

**Q: What happens if the AI is unavailable?**
> Submissions are marked "needs_review" so managers can manually review them. The cron job also recovers submissions stuck in processing for more than 5 minutes.

### Technical Questions

**Q: Where is data stored?**
> PostgreSQL database on Supabase (AWS infrastructure). Files stored on Vercel Blob. All data encrypted at rest and in transit.

**Q: Is there vendor lock-in?**
> Minimal. Supabase is open-source PostgreSQL. The AI uses the OpenAI-compatible SDK format. Next.js can be self-hosted. The main Vercel-specific feature is Blob storage, which could be migrated to S3.

**Q: Can this handle high traffic?**
> Yes. Vercel auto-scales serverless functions. Supabase connection pooling handles concurrent database queries. Rate limiting prevents abuse. The architecture has no fixed-capacity bottlenecks.

**Q: How is the database backed up?**
> Supabase provides automated daily backups with point-in-time recovery on the Pro plan.

---

## 5. Design System Overview

### Design Philosophy
- **Notion-inspired** warm neutral palette
- **Light + Dark mode** via CSS custom properties
- **Typography**: Inter (body), JetBrains Mono (code)
- **Component Library**: Shadcn/ui (40+ accessible components)
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

## 6. File Inventory (Key Source Files)

| File | Lines | Purpose |
|------|-------|---------|
| `lib/llm/pipeline.ts` | 578 | AI validation pipeline orchestrator |
| `lib/data.ts` | 561 | All database read queries |
| `lib/llm/validate.ts` | 329 | LLM calls (rules, summary, vision) |
| `app/actions/submissions.ts` | 299 | Submission CRUD server actions |
| `app/actions/tasks.ts` | 265 | Task CRUD server actions |
| `lib/inngest/functions.ts` | 217 | Inngest background job definitions |
| `scripts/001_init_schema.sql` | 214 | Database schema (11 tables) |
| `lib/types.ts` | 204 | TypeScript type definitions |
| `app/globals.css` | 223 | Design token system |
| `app/api/cron/mark-missed/route.ts` | 110 | Cron deadline enforcement |
| `lib/parse/index.ts` | 103 | Document text extraction |
| `next.config.mjs` | 87 | Next.js + security configuration |
| `lib/supabase/proxy.ts` | 70 | Edge auth middleware |
| `lib/auth.ts` | 65 | Cached auth helpers |
| `lib/redis.ts` | 37 | Rate limiting configuration |

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

> **Prepared by JobFlowAI Engineering — May 2, 2026**
> 
> *Hierarchia Manager Portal v0.1.0 — Production Ready*
