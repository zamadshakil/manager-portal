# Data Flows & User Journeys

> **Client Delivery Document** | Part 4 of 6

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
        ├── Upload file → Vercel Blob (private, random suffix)
        ├── INSERT INTO submissions (status: "queued")
        ├── UPDATE task_assignments (status: "submitted")
        ├── logActivity("submission.created")
        └── Return { submissionId } to client
                │
                ▼
        Client triggers: POST /api/pipeline/{id}
                │
                ▼
        Inngest event: "app/submission.process"
                │
                ▼
        ┌──── AI PIPELINE (background) ────┐
        │                                   │
        │  Step 1: Load submission + rules  │
        │  Step 2: Set status → "parsing"   │
        │  Step 3: Download blob → parse    │
        │          PDF → unpdf              │
        │          DOCX → mammoth           │
        │          Image → Nemotron VL      │
        │  Step 4: Set status → "validating"│
        │  Step 5+: Run each rule via LLM   │
        │          DeepSeek V3 scores 0-100 │
        │  Step N: Generate summary         │
        │  Step N+1: Finalize               │
        │          Weighted score calc      │
        │          Save validation_runs     │
        │          Final status:            │
        │          passed/failed/needs_rev  │
        │                                   │
        └───────────────────────────────────┘
```

---

## 4. Data Flow: Cron — Mark Missed Deadlines

```
Vercel Cron (daily at 00:00 UTC)
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
        └── Record execution in Redis for monitoring
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
        ├── Fetch blob from Vercel Blob (private access)
        └── Stream file to browser with correct Content-Type
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
─────────────────────────────────────────────────────────
Dashboard Home              ✓            ✓           ✓
View Submissions           all          team        own
Create Submission           ✗            ✗           ✓
Retry Submission           all          team        own
Delete Submission          all          team         ✗
─────────────────────────────────────────────────────────
View Tasks                 all          team       assigned
Create Task                all          team         ✗
Assign Task                all          team         ✗
Delete Task                all          team         ✗
─────────────────────────────────────────────────────────
View Rules                 all          team         ✗
Create/Edit Rule           all          team         ✗
Delete Rule                all          team         ✗
─────────────────────────────────────────────────────────
View Teams                  ✓           own          ✗
Create/Edit/Delete Team     ✓            ✗           ✗
Assign Manager              ✓            ✗           ✗
Provision User              ✓            ✗           ✗
─────────────────────────────────────────────────────────
Announcements (CRUD)       all          team         ✗
Materials (CRUD)           all          team         ✗
Activity Log (View)        all          team         ✗
Reports (View)             all          team         ✗
Settings (Own Profile)      ✓            ✓           ✓
```

---

*Next: [05 — Environment & Deployment Guide](./05_DEPLOYMENT_GUIDE.md)*
