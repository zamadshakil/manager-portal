# Hierarchia Manager Portal — Executive Overview

> **Client Delivery Document** | Version 1.0 | May 2, 2026  
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
- Supports **PDF, DOCX, PPTX, PNG, JPEG** (up to 25 MB)
- Text extraction via native parsers + AI vision for images
- Configurable validation rules with custom prompts, thresholds, and weights
- Weighted scoring with pass/fail/needs-review outcomes
- Executive summaries and predictive risk flags

### 📋 Task & Assignment Management
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
- 4-layer defense: Edge proxy → Route guards → Server action checks → RLS
- Security headers (HSTS, CSP, X-Frame-Options)
- Rate limiting on uploads and LLM calls
- Append-only audit log

---

## 4. Technology Stack Summary

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | Next.js 16, React 19 | Server-side rendering, server components |
| **UI Components** | Shadcn/ui + Radix UI | Accessible, composable component library |
| **Styling** | Tailwind CSS 4 | Utility-first CSS with design token system |
| **Database** | Supabase (PostgreSQL) | Managed Postgres with RLS and real-time |
| **Authentication** | Supabase Auth | Session management, JWT tokens |
| **File Storage** | Vercel Blob | Private document storage with signed URLs |
| **AI Inference** | DigitalOcean AI (DeepSeek V3, Nemotron VL) | Document validation and vision OCR |
| **Background Jobs** | Inngest | Durable, step-based async pipelines |
| **Caching & Rate Limiting** | Upstash Redis | Rate limiting, pipeline locks, cron monitoring |
| **Deployment** | Vercel | Serverless deployment with edge functions |
| **Analytics** | Vercel Analytics | Web vitals and usage tracking |
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
│  1. UPLOAD       │  File → Vercel Blob (private)
│                  │  Submission row → status: "queued"
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  2. PARSE        │  PDF → unpdf | DOCX → mammoth
│                  │  PPTX → officeparser | Image → AI Vision
│                  │  status: "parsing"
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  3. VALIDATE     │  Run each enabled validation rule
│                  │  DeepSeek V3 scores 0-100 per rule
│                  │  Concurrent with rate limiting
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
│                  │  Final status: passed/failed/needs_review
│                  │  Results saved to database
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
| Activity | `/dashboard/activity` | Audit log of all system actions |
| Reports | `/dashboard/reports` | Analytics and metric snapshots |
| Settings | `/dashboard/settings` | Profile and password management |

---

*Next: [02 — Technical Architecture Deep Dive](./02_TECHNICAL_ARCHITECTURE.md)*
