# Hierarchia Manager Portal — Executive Overview

> **Client Delivery Document** | Version 2.0 | May 8, 2026  
> **Prepared by:** JobFlowAI Engineering

---

## 1. What Is Hierarchia?

**Hierarchia** is an AI-powered task and document management portal that enables organizations to create tasks, assign them to team members, collect document submissions, and automatically validate those documents using artificial intelligence — all in real time.

### The One-Liner

> "Hierarchia replaces manual document review with an AI-driven pipeline that parses, validates, scores, and summarizes every submission — in under 60 seconds."

---

## 2. The Problem It Solves

| Without Hierarchia | With Hierarchia |
|---|---|
| Managers manually review every submitted document | AI validates documents automatically against configurable rules |
| No visibility into submission status or deadlines | Real-time dashboard with pass rates, scores, and deadline tracking |
| Late submissions go untracked | Automatic deadline enforcement with late-submission policies |
| No audit trail of who did what | Full activity logging with IP, timestamp, and actor attribution |
| Team management scattered across tools | Unified portal with role-based access for admins, managers, and members |

---

## 3. Key Features at a Glance

### 🤖 AI-Powered Document Validation
- Supports **PDF, DOCX, PPTX, XLSX, PNG, JPEG, plain text/Markdown** (up to 25 MB)
- Native text extraction (`unpdf`, `mammoth`, `officeparser`) + Gemini Vision OCR fallback for images and scanned PDFs
- Configurable validation rules with custom prompts, thresholds, and weights
- Per-task `rule_ids` selection and an optional task-specific AI brief
- Weighted scoring with pass / fail / needs_review outcomes
- Executive summaries and predictive risk flags

### � Smart AI Conversational Assistant
- Chat against the live Supabase database with native tool-calling
- Native RAG retrieval over `rag_documents` (pgvector + BM25 full-text, RRF fusion, keyword reranking)
- Document upload + automatic chunk indexing for chat-attached files
- Persistent chat threads with history per user
- Per-user AI credit quotas with configurable refill periods

### 📬 In-App Messaging
- Direct messages and group conversations between any portal users
- Realtime delivery via Supabase Realtime (WebSocket)
- Typing indicators, presence, reactions, replies, edit/delete
- File / image / audio / video attachments uploaded to Cloudflare R2
- Per-conversation `last_read_at` for unread counts; soft-delete for messages

### � Task & Assignment Management
- Hierarchical task creation with deadlines
- Bulk or selective team member assignment
- Late submission policies (allow/deny, require reason)
- Per-task validation rule selection
- Automatic missed-deadline enforcement via cron jobs

### 👥 Role-Based Access Control (3 Roles)
| Role | Capabilities |
|------|-------------|
| **Main Admin** | Full system access — create teams, provision users, manage everything |
| **Manager** | Manage own team — create tasks, configure rules, review submissions |
| **Member** | View assigned tasks, upload submissions, track personal progress |

### 📊 Analytics Dashboard
- Daily metrics charts (submissions, pass rates, scores)
- Per-team and per-member breakdowns
- 30-day trend visualization via Recharts

### 🔐 Enterprise-Grade Security
- Row-Level Security (RLS) on every database table
- 3-layer defense: Middleware → Server Action → Postgres RLS
- Security headers (HSTS, CSP, X-Frame-Options DENY, Permissions-Policy)
- Rate limiting on uploads, LLM calls, chat, and messaging
- Append-only audit log
- `server-only` imports protect service-role credentials at build time

---

## 4. Technology Stack Summary

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | Next.js 16, React 19 | RSC-first app router, server actions |
| **UI Components** | shadcn/ui + Radix UI | Accessible, composable component library |
| **Styling** | Tailwind CSS 4 | Utility-first CSS with design token system |
| **Database** | Self-hosted Supabase Postgres + pgvector (on Railway) | Postgres with RLS, full-text search, vector search |
| **Authentication** | Self-hosted Supabase GoTrue (on Railway) | Session management, JWT, provision-only onboarding |
| **File Storage** | Cloudflare R2 (S3-compatible) | Private document storage, fronted by an authenticated download proxy |
| **AI — Validation** | OpenRouter → Gemini 2.0 Flash (Vercel AI SDK v6) | Rule evaluation, summarisation, vision OCR |
| **AI — Smart AI Chat** | OpenRouter → GPT-4o-mini (configurable) | Tool-calling assistant with native pgvector RAG |
| **Background Jobs** | In-process async pipeline + Railway HTTP cron | Fire-and-forget validation + scheduled cleanup every 15 min |
| **Realtime** | Supabase Realtime (WebSocket) | Messaging delivery, assignment updates |
| **Caching & Rate Limiting** | Railway-native Redis (ioredis) | Rate limiting, idempotency locks, cron observability |
| **Email** | Brevo (Sendinblue) | Welcome emails, email-change verification |
| **Deployment** | Railway | Single project hosts the Next.js app + the entire self-hosted Supabase stack |
| **Validation** | Zod | Runtime schema validation for all inputs |
| **Charts** | Recharts | Data visualization on dashboards |

---

## 5. User Roles Explained

### Main Admin
The system administrator who sets up the organizational structure:
- Creates and manages **teams** (departments)
- **Provisions new users** with temporary passwords
- Assigns **managers** to teams
- Has full visibility across all teams and data

### Manager
A team lead who drives day-to-day operations:
- Creates **tasks** with instructions, deadlines, and validation rules
- **Assigns tasks** to team members (all or selected)
- Configures **AI validation rules** (custom prompts, thresholds, weights)
- Reviews submissions and their AI-generated scores/flags
- Manages **announcements** and **materials** for their team

### Member
A team participant who executes assigned work:
- Views their **assigned tasks** with deadlines
- **Uploads document submissions** against tasks
- Tracks **submission status** in real time (queued → parsing → validating → result)
- Provides **late reasons** when submitting past deadlines

---

## 6. How the AI Validation Pipeline Works

```
Member uploads file
        │
        ▼
┌─────────────────┐
│  1. UPLOAD       │  File → Cloudflare R2 (private, random suffix)
│                  │  Submission row → status: "queued"
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  2. PARSE        │  PDF → unpdf (+ Gemini Vision OCR fallback)
│                  │  DOCX → mammoth | PPTX/XLSX → officeparser
│                  │  Images → Gemini Vision OCR
│                  │  status: "parsing"
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  3. VALIDATE     │  Run each enabled validation rule in parallel
│                  │  Gemini 2.0 Flash (via OpenRouter) scores 0-100
│                  │  Optional task-specific brief appended as a rule
│                  │  Rate-limited per team via Redis
│                  │  status: "validating"
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  4. SUMMARIZE    │  Executive summary + topic extraction
│                  │  Predictive risk flags
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  5. SCORE        │  Weighted aggregate across all rules
│                  │  Final status: passed / failed / needs_review
│                  │  validation_runs persisted; assignment mirrored
│                  │  Submission text indexed into pgvector for RAG
└─────────────────┘
```

---

## 7. Dashboard Pages

| Page | Route | Description |
|------|-------|-------------|
| Dashboard Home | `/dashboard` | KPI cards, recent submissions, daily charts |
| Submissions | `/dashboard/submissions` | Full submission list with filters and detail views |
| Tasks | `/dashboard/tasks` | Task management (create/assign for managers, view for members) |
| Rules | `/dashboard/rules` | AI validation rule configuration |
| Team | `/dashboard/team` | Team/department management (admin), member view (manager) |
| Departments | `/dashboard/departments` | Organization-wide department overview |
| Announcements | `/dashboard/announcements` | Team-wide announcements with priority levels |
| Materials | `/dashboard/materials` | Shared reference documents and resources |
| Smart AI | `/dashboard/smart-ai` | Conversational AI assistant with RAG + tool-calling |
| Messages | `/dashboard/messages` | DMs and group conversations with realtime delivery |
| AI Usage | `/dashboard/ai-usage` | Per-user AI credit consumption + admin allowance management |
| Activity | `/dashboard/activity` | Audit log of all system actions |
| Reports | `/dashboard/reports` | Analytics and metric snapshots |
| Settings | `/dashboard/settings` | Profile, password, and email management |

---

*Next: [02 — Technical Architecture Deep Dive](./02_TECHNICAL_ARCHITECTURE.md)*
