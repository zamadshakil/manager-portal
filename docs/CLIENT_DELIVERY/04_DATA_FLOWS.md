# Data Flows & User Journeys

> **Client Delivery Document** | Part 4 of 6 | Version 2.0 | May 8, 2026

---

## 1. User Journey: Admin Sets Up Organization

```
Admin logs in
    │
    ├── 1. Create Team "Marketing"
    │       └─ Server Action: createTeam()
    │           ├─ requireRole(["main_admin"])
    │           ├─ Zod validates input
    │           ├─ INSERT INTO teams
    │           └─ logActivity("team.created")
    │
    ├── 2. Provision User "alice@company.com" as Manager
    │       └─ Server Action: provisionUser()
    │           ├─ Creates Supabase Auth user
    │           ├─ Sets must_reset = true
    │           ├─ Assigns role = "manager"
    │           └─ Links to team_id
    │
    ├── 3. Provision Members "bob@..." and "carol@..."
    │       └─ Same flow, role = "member"
    │
    └── 4. Assign Alice as team manager
            └─ Server Action: assignTeamManager()
                ├─ UPDATE teams SET manager_id = alice.id
                └─ logActivity("team.manager_assigned")
```

---

## 2. User Journey: Manager Creates a Task

```
Alice (Manager) → /dashboard/tasks → "New Task"
    │
    ├── Fills form:
    │   ├─ Title: "Q2 Report Submission"
    │   ├─ Instructions: "Submit a PDF with revenue analysis..."
    │   ├─ Deadline: 2026-05-15
    │   ├─ Allow late: Yes (require reason)
    │   └─ Rules: [Revenue Check, Format Check]
    │
    └── Submit → createTask(formData)
        │
        ├── 1. requireRole(["main_admin", "manager"])
        ├── 2. Zod validates all fields
        ├── 3. canManageTeam(profile, team_id) ✓
        ├── 4. INSERT INTO tasks (with rule_ids)
        ├── 5. Fetch all team members with role="member"
        ├── 6. INSERT INTO task_assignments (one per member)
        ├── 7. logActivity("task.created", { assigned: 2 })
        └── 8. revalidatePath("/dashboard/tasks")
```

---

## 3. User Journey: Member Submits a Document

```
Bob (Member) → /dashboard/tasks → sees "Q2 Report" → "Submit"
    │
    ├── 1. Selects PDF file + enters title
    │
    └── 2. Submit → createSubmission(formData)
        │
        ├── requireProfile() → verify Bob is authenticated
        ├── Validate file: size ≤ 25MB, type ∈ accepted list
        ├── Zod validates title, taskId, lateReason
        ├── uploadLimiter.limit("user:bob-id") → rate check
        │
        ├── Task linkage:
        │   ├── Fetch task → verify same team
        │   ├── Fetch assignment → verify Bob is assignee
        │   ├── Check deadline → is it late?
        │   │   ├── Not late → proceed
        │   │   ├── Late + allow_late=false → REJECT
        │   │   └── Late + allow_late=true → mark is_late=true
        │   └── Verify not already submitted
        │
        ├── Upload file → Cloudflare R2 (private, random suffix)
        ├── INSERT INTO submissions (status: "queued")
        ├── UPDATE task_assignments (status: "submitted" | "late_submitted")
        ├── logActivity("submission.created")
        └── after(processSubmission(id))   ← fire-and-forget, in-process
                │
                ▼
        ┌──── AI PIPELINE (in-process, async) ────┐
        │                                          │
        │  Redis SETNX idempotency lock (10 min)   │
        │  Step 1: Load submission + rules         │
        │  Step 2: Set status → "parsing"          │
        │  Step 3: Stream R2 file → parse          │
        │          PDF → unpdf (+ vision OCR)      │
        │          DOCX → mammoth                  │
        │          PPTX/XLSX → officeparser        │
        │          Image → Gemini Vision           │
        │  Step 4: Set status → "validating"       │
        │  Step 5+: Run each rule via OpenRouter   │
        │          Gemini 2.0 Flash scores 0-100   │
        │          (+ optional task AI brief)      │
        │  Step N: Generate summary + risk flags   │
        │  Step N+1: Finalize                      │
        │          Weighted score calc             │
        │          Save validation_runs            │
        │          Index extracted text into       │
        │           rag_documents (pgvector)        │
        │          Final status:                   │
        │          passed/failed/needs_review/late │
        │                                          │
        └──────────────────────────────────────────┘
```

---

## 4. Data Flow: Cron — Mark Missed Deadlines & Cleanup

```
Railway HTTP cron (every 15 minutes)
    │
    └── GET /api/cron/mark-missed
        │
        ├── Auth: Verify CRON_SECRET header
        │
        ├── Step 1: Find overdue assignments
        │   SELECT task_assignments
        │   WHERE status = 'assigned'
        │   AND task.due_at < NOW()
        │   AND task.allow_late = false
        │       │
        │       └── UPDATE status = 'missed'
        │
        ├── Step 2: Recover stuck submissions
        │   WHERE status IN ('queued','parsing','validating')
        │   AND updated_at < (NOW - 5 minutes)
        │       │
        │       └── UPDATE status = 'failed'
        │           + flag: "Pipeline timed out"
        │
        ├── Step 3: Expire announcements / materials
        │   WHERE expires_at < NOW()
        │       │
        │       └── DELETE row
        │           + remove from rag_documents
        │
        └── Record execution in Redis (`cron:mark-missed:executions`) for monitoring
```

---

## 5. Data Flow: Secure File Download

```
User clicks "Download" on a submission
    │
    └── GET /api/download/{submission-id}
        │
        ├── Authenticate user via Supabase session
        ├── Fetch submission row (RLS enforced)
        ├── Verify user can access this submission:
        │   ├── Admin → always ✓
        │   ├── Manager → same team ✓
        │   └── Member → own submission ✓
        │
        ├── Fetch object from Cloudflare R2 (server-side, private)
        └── Stream file to browser with correct Content-Disposition / Content-Type
```

---

## 6. Data Flow: Dashboard Analytics

```
Manager opens /dashboard
    │
    └── Server Component renders:
        │
        ├── getDashboardSummary(profile)
        │   ├── Count total submissions (team-scoped)
        │   ├── Count passed / failed / needs_review
        │   ├── Calculate pass rate %
        │   ├── Calculate average score
        │   └── Fetch 6 most recent submissions
        │
        ├── getDailyMetrics(profile, 30)
        │   ├── Fetch last 30 days of submissions
        │   ├── Bucket by day
        │   ├── Calculate per-day: count, passed, failed, avg_score
        │   └── Fill missing days with zeros (stable chart axis)
        │
        └── Render:
            ├── KPI Cards (total, passed, failed, review, rate, score)
            ├── Recharts line/bar chart (30-day trend)
            └── Recent submissions table
```

---

## 7. Authentication Flow

```
User visits any /dashboard/* page
    │
    ▼
Edge Proxy (middleware.ts)
    │
    ├── Refresh Supabase session cookie
    ├── Call supabase.auth.getUser()
    │
    ├── No user? → Redirect to /auth/login?next=/dashboard
    │
    └── User exists → Continue to page
            │
            ▼
    Dashboard Layout
        │
        ├── requireProfile() [React.cache — shared across layout+page]
        │   ├── supabase.auth.getUser()  ← cached, no duplicate call
        │   └── SELECT * FROM profiles WHERE id = user.id
        │
        ├── must_reset check
        │   └── If true → redirect to /dashboard/settings?reset=1
        │
        └── Render sidebar + top bar + page content
```

---

## 8. Permission Matrix (Complete)

```
                        main_admin    manager     member
─────────────────────────────────────────────
Dashboard Home              ✓            ✓           ✓
View Submissions           all          team        own
Create Submission           ✗            ✗           ✓
Retry Submission           all          team        own
Delete Submission          all          team         ✗
─────────────────────────────────────────────
View Tasks                 all          team       assigned
Create Task                all          team         ✗
Assign Task                all          team         ✗
Delete Task                all          team         ✗
─────────────────────────────────────────────
View Rules                 all          team         ✗
Create/Edit Rule           all          team         ✗
Delete Rule                all          team         ✗
─────────────────────────────────────────────
View Teams                  ✓           own          ✗
Create/Edit/Delete Team     ✓            ✗           ✗
Assign Manager              ✓            ✗           ✗
Provision User              ✓            ✗           ✗
─────────────────────────────────────────────
Announcements (CRUD)       all          team         ✗
Materials (CRUD)           all          team         ✗
Activity Log (View)        all          team         ✗
Reports (View)             all          team         ✗
Smart AI chat              ✓            ✓           ✓  (own threads only)
Messaging (DMs/groups)     ✓            ✓           ✓  (members of conv only)
AI Usage — own              ✓            ✓           ✓
AI Usage — admin controls   ✓            ✗           ✗
Settings (Own Profile)      ✓            ✓           ✓
```

---

## 9. Data Flow: Smart AI Chat Turn

```
User asks a question in /dashboard/smart-ai
    │
    └── POST /api/smart-ai/chat (streaming)
        │
        ├── Authenticate user + check chat rate limit (Redis)
        ├── Resolve / create chat_thread
        ├── Hybrid retrieval (lib/smart-ai/retriever.ts)
        │   ├─ Embed query (OpenAI text-embedding-3-small)
        │   ├─ pgvector ANN search on rag_documents
        │   ├─ BM25 full-text search on the same table
        │   ├─ RRF fusion + keyword reranking
        │   └─ Filter by RLS-visible scope (team / global / user)
        ├── Build prompt with retrieved chunks as context
        ├── Call OpenRouter → SMART_AI_MODEL with tool definitions
        │     • queryDatabase(table, filters)
        │     • searchDocument(query)
        ├── Stream tokens to client (Server-Sent Events / Vercel AI SDK)
        ├── Persist assistant message + tool calls into chat_messages
        └── Decrement AI credits via ai_usage_increment_rpc
```

---

## 10. Data Flow: Sending a Message

```
User types in MessageComposer
    │
    └── POST /api/messaging/messages
        │
        ├── requireProfile() + Zod validate body
        ├── Messaging rate limiter (Redis sliding-window)
        ├── RLS-checked INSERT into messages
        │     • type ∈ {text, image, file, audio, video}
        │     • reply_to_id optional
        │     • media_url + media_metadata for attachments
        ├── Trigger: bump_conversation_updated_at fires
        │     → conversations.updated_at = now()
        ├── Supabase Realtime publication broadcasts INSERT
        │     → every connected member receives it via
        │        hooks/use-conversation-realtime.ts
        └── Return new message to sender for optimistic UI
```

For file attachments the client first hits `POST /api/messaging/upload` (R2 multipart upload) and then sends the resulting URL + metadata through the message endpoint.


---

*Next: [05 — Environment & Deployment Guide](./05_DEPLOYMENT_GUIDE.md)*
