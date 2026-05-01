# Glossary of Terms & Technologies

> **Client Delivery Document** | Part 3 of 6

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
| **Background Job** | A long-running process (like AI validation) that executes asynchronously so the user doesn't wait. Powered by Inngest. |
| **Blob Storage** | Vercel Blob — a managed file storage service where uploaded documents are stored privately with signed access URLs. |

## C

| Term | Definition |
|------|-----------|
| **CRON Job** | A scheduled task that runs at fixed intervals. Hierarchia uses a daily cron (`0 0 * * *`) to mark missed deadlines and recover stuck submissions. |
| **CSP (Content Security Policy)** | A security header that restricts which external resources (scripts, styles, images) the browser is allowed to load. Prevents XSS attacks. |

## D

| Term | Definition |
|------|-----------|
| **Dashboard** | The main authenticated interface. Role-adaptive: admins see everything, managers see their team, members see their assignments. |
| **DeepSeek V3** | An open-source LLM (Large Language Model) used for document validation and summarization. Accessed via DigitalOcean's AI Inference API. |
| **Design Tokens** | CSS custom properties (`--primary`, `--background`, etc.) that define the visual theme. Supports light and dark modes. |

## E

| Term | Definition |
|------|-----------|
| **Edge Proxy** | Next.js middleware running on Vercel's edge network. Handles session refresh and authentication redirects before the page renders. |
| **Extracted Text** | Plain text pulled from uploaded documents (PDF, DOCX, PPTX, images) by the parsing stage. Fed to the AI for validation. |

## F

| Term | Definition |
|------|-----------|
| **Flags** | Structured feedback from the AI validation. Each flag has a severity (`info`, `warn`, `fail`) and a human-readable message. |

## H–I

| Term | Definition |
|------|-----------|
| **HSTS** | HTTP Strict Transport Security — forces browsers to only connect via HTTPS. |
| **Idempotency Lock** | A Redis-based mutex that prevents the same submission from being processed twice simultaneously. Uses `SETNX` with a 10-minute TTL. |
| **Inngest** | A durable workflow engine for background jobs. Each pipeline stage is an independent "step" with automatic retries and observability. |

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
| **Nemotron VL** | A vision-language model used for OCR — extracts text from uploaded images (PNG, JPEG). |
| **Next.js** | A React framework for building full-stack web applications with server-side rendering, API routes, and serverless deployment. |

## P–Q

| Term | Definition |
|------|-----------|
| **Pipeline** | The end-to-end automated process: upload → parse → validate → summarize → score. Runs as a background job. |
| **Pipeline Budget** | A soft time limit (50 seconds) on the validation pipeline. If exhausted, partial results are saved and the submission is marked for manual review. |
| **Profile** | A row in the `profiles` table that extends Supabase Auth with role, team assignment, and display name. |
| **Prompt Template** | The AI instruction text written by a manager for a validation rule. Tells the LLM what to check for in the document. |

## R

| Term | Definition |
|------|-----------|
| **Radix UI** | A low-level, accessible component library. Provides the foundation for all UI components (dialogs, dropdowns, tabs, etc.). |
| **Rate Limiting** | Throttling mechanism using Upstash Redis to prevent abuse. Limits uploads per user and LLM calls per team. |
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
| **Submission** | A document uploaded by a member, linked to a task. Progresses through: `queued` → `parsing` → `validating` → `passed`/`failed`/`needs_review`. |
| **Supabase** | An open-source Firebase alternative providing PostgreSQL database, authentication, and real-time subscriptions. |

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
| **Upstash Redis** | A serverless Redis service used for rate limiting, pipeline locks, and cron execution monitoring. |
| **Validation Rule** | A manager-defined AI evaluation criterion with a prompt template, threshold, weight, and enabled/disabled toggle. |
| **Validation Run** | A record of one rule being evaluated against one submission. Stores score, pass/fail, reasons, flags, and latency. |
| **Vercel** | The deployment platform. Provides serverless functions, edge network, CDN caching, and automatic CI/CD from Git pushes. |
| **Vercel Blob** | Managed file storage by Vercel. Documents are stored with private access and streamed during pipeline processing. |

## W–Z

| Term | Definition |
|------|-----------|
| **Weighted Score** | The aggregate submission score calculated as: `Σ(rule_score × rule_weight) / Σ(rule_weight)`. Higher-weight rules have more influence. |
| **Web Vitals** | Core performance metrics (LCP, FID, CLS) reported to Vercel Analytics for monitoring page load performance. |
| **Zod** | A TypeScript-first schema validation library. Every form input and API parameter is validated with Zod before processing. |

---

*Next: [04 — Data Flow & User Journeys](./04_DATA_FLOWS.md)*
