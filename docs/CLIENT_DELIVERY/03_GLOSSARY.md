# Glossary of Terms & Technologies

> **Client Delivery Document** | Part 3 of 6 | Version 2.0 | May 8, 2026

---

## A — Application Terms

| Term | Definition |
|------|-----------|
| **Assignment** | A link between a Task and a Member. Each assignment tracks status: `assigned` → `submitted` / `late_submitted` / `missed`. |
| **Activity Log** | An append-only audit table recording every significant action (task creation, submission, deletion) with actor, timestamp, IP, and metadata. |
| **Announcement** | A team-wide or global notice created by managers/admins with priority levels (low, normal, high, urgent) and optional expiry dates. |

## B

| Term | Definition |
|------|-----------|
| **Background Job** | A long-running process (like AI validation) that executes asynchronously so the user doesn't wait. Hierarchia uses an **in-process async pipeline** (fire-and-forget) plus Railway HTTP cron for scheduled cleanup. |
| **Brevo** | Transactional email provider used for welcome emails on user provisioning and email-change verification. |

## C

| Term | Definition |
|------|-----------|
| **CRON Job** | A scheduled task that runs at fixed intervals. Hierarchia uses a Railway HTTP cron (every 15 minutes) to mark missed deadlines, recover stuck submissions, and expire announcements / materials. |
| **CSP (Content Security Policy)** | A security header that restricts which external resources (scripts, styles, images) the browser is allowed to load. Prevents XSS attacks. |

## D

| Term | Definition |
|------|-----------|
| **Dashboard** | The main authenticated interface. Role-adaptive: admins see everything, managers see their team, members see their assignments. |
| **Conversation** | A messaging container — either a `dm` (two members) or a `group` (n members). Lives in the `conversations` table. |
| **Cloudflare R2** | S3-compatible object storage used for submissions, materials, chat document uploads, and messaging attachments. Always accessed through the authenticated download proxy on the server, never linked directly. |
| **Design Tokens** | CSS custom properties (`--primary`, `--background`, etc.) that define the visual theme. Supports light and dark modes. |

## E

| Term | Definition |
|------|-----------|
| **Edge Proxy** | Next.js middleware (`proxy.ts`) that handles Supabase session refresh, the `must_reset` gate, and authentication redirects before the page renders. |
| **Extracted Text** | Plain text pulled from uploaded documents (PDF, DOCX, PPTX, images) by the parsing stage. Fed to the AI for validation. |

## F

| Term | Definition |
|------|-----------|
| **Flags** | Structured feedback from the AI validation. Each flag has a severity (`info`, `warn`, `fail`) and a human-readable message. |

## H–I

| Term | Definition |
|------|-----------|
| **HSTS** | HTTP Strict Transport Security — forces browsers to only connect via HTTPS. |
| **Idempotency Lock** | A Redis-based mutex that prevents the same submission from being processed twice simultaneously. Uses `SETNX` with a 10-minute TTL on Railway-native Redis. |
| **In-Process Pipeline** | The validation pipeline runs as a fire-and-forget async function inside the Next.js server process (using `after()`), not on a separate worker. Crash recovery is handled by the cron sweep. |

## J–L

| Term | Definition |
|------|-----------|
| **JWT** | JSON Web Token — the authentication token format used by Supabase Auth. Carried in cookies. |
| **Late Submission** | A submission uploaded after the task's `due_at` deadline. Can be allowed or blocked per-task. May require a written reason. |
| **LLM** | Large Language Model — the AI technology that reads and evaluates documents. |

## M–N

| Term | Definition |
|------|-----------|
| **Main Admin** | The highest-privilege role. Can create teams, provision users, and manage the entire organization. |
| **Manager** | A team lead who creates tasks, configures validation rules, and reviews submissions within their team scope. |
| **Member** | A team participant who receives task assignments, uploads submissions, and tracks their progress. |
| **Material** | A shared reference document (guidelines, templates) uploaded by managers for team access. |
| **Middleware** | Code that runs before every request reaches the page. Used for auth session refresh and route protection. |
| **Mutation** | A data-changing operation (create, update, delete) implemented as a Next.js Server Action. |
| **Messaging** | The DM and group chat subsystem — lives at `/dashboard/messages`. Backed by `conversations`, `conversation_members`, `messages`, `message_reactions`. Uses Supabase Realtime for live delivery. |
| **Next.js** | A React framework for building full-stack web applications with server-side rendering, API routes, and standalone production builds. |

## P–Q

| Term | Definition |
|------|-----------|
| **OpenRouter** | LLM gateway used for both validation (Gemini 2.0 Flash) and Smart AI chat (GPT-4o-mini default). The OpenRouter key is the single secret that powers all model traffic. |
| **Pipeline** | The end-to-end automated process: upload → parse → validate → summarize → score. Runs in-process. |
| **Pipeline Budget** | A soft time limit on the validation pipeline. If exhausted, partial results are saved and the submission is marked for manual review. |
| **Profile** | A row in the `profiles` table that extends Supabase Auth with role, team assignment, and display name. |
| **Prompt Template** | The AI instruction text written by a manager for a validation rule. Tells the LLM what to check for in the document. |

## R

| Term | Definition |
|------|-----------|
| **Radix UI** | A low-level, accessible component library. Provides the foundation for all UI components (dialogs, dropdowns, tabs, etc.). |
| **Railway** | The hosting platform. Hosts the Next.js app, the entire self-hosted Supabase stack, and the Redis plugin in a single project. |
| **RAG (Retrieval-Augmented Generation)** | The Smart AI assistant retrieves relevant chunks from `rag_documents` (pgvector + BM25 with RRF fusion) and includes them as context for the LLM. |
| **Rate Limiting** | Sliding-window throttling backed by Railway-native Redis (ioredis). Limits uploads per user, LLM calls per team, chat per user, and messaging sends. |
| **React Server Components (RSC)** | React components that render on the server, reducing client-side JavaScript. Pages load faster and data fetching is more secure. |
| **Recharts** | A React charting library used for the dashboard's daily metrics visualization. |
| **RLS (Row-Level Security)** | PostgreSQL feature that restricts which rows a user can see/modify based on their identity. Every table has RLS policies. |
| **RPC** | Remote Procedure Call — custom SQL functions called via Supabase (e.g., `list_departments_with_stats`, `assign_task_to_team`). |

## S

| Term | Definition |
|------|-----------|
| **Server Action** | A Next.js feature that lets you write server-side mutation functions called directly from React forms. Used for all CRUD operations. |
| **Server Component** | A React component that renders on the server. Can directly access the database and environment variables. Cannot use `useState` or browser APIs. |
| **Shadcn/ui** | A copy-paste component library built on Radix UI + Tailwind CSS. Provides pre-styled, accessible UI components. |
| **Smart AI** | Hierarchia's native conversational assistant. Streams responses, calls tools (database queries + document search), and persists threads. |
| **Soft Delete** | A row that is marked deleted (e.g. `messages.deleted_at`, `profiles` deactivation) without being physically removed, so foreign keys and audit trails stay intact. |
| **Submission** | A document uploaded by a member, linked to a task. Progresses through: `queued` → `parsing` → `validating` → `passed`/`failed`/`needs_review`/`late_submitted`. |
| **Supabase (self-hosted)** | An open-source Firebase alternative providing PostgreSQL, authentication, storage, and Realtime. Hierarchia self-hosts the entire stack on Railway behind Kong. |

## T

| Term | Definition |
|------|-----------|
| **Tailwind CSS** | A utility-first CSS framework. Classes like `bg-primary`, `text-muted-foreground` map to design tokens. |
| **Task** | A work item created by a manager with a title, instructions, deadline, and validation configuration. Assigned to team members. |
| **Team** | An organizational unit (department). Members belong to one team. Managers oversee one team. |
| **Threshold** | The minimum score (0-100) a document must achieve on a validation rule to pass. Default: 70. |

## U–V

| Term | Definition |
|------|-----------|
| **Validation Rule** | A manager-defined AI evaluation criterion with a prompt template, threshold, weight, and enabled/disabled toggle. May be team-scoped or global. |
| **Validation Run** | A record of one rule being evaluated against one submission. Stores score, pass/fail, reasons, flags, and latency. |
| **Vercel AI SDK** | The library used to talk to OpenRouter (`generateObject`, `generateText`, tool-calling). Hierarchia is **not** deployed on Vercel — only the SDK is used. |

## W–Z

| Term | Definition |
|------|-----------|
| **Weighted Score** | The aggregate submission score calculated as: `Σ(rule_score × rule_weight) / Σ(rule_weight)`. Higher-weight rules have more influence. |
| **Web Vitals** | Core performance metrics (LCP, FID, CLS) reported to `/api/vitals` for monitoring page load performance. |
| **Zod** | A TypeScript-first schema validation library. Every form input and API parameter is validated with Zod before processing. |

---

*Next: [04 — Data Flow & User Journeys](./04_DATA_FLOWS.md)*
