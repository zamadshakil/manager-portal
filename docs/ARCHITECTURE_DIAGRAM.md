# Task & Team Management Architecture

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        HIERARCHIA MANAGER PORTAL                │
└─────────────────────────────────────────────────────────────────┘

┌─ ADMIN PANEL ─────────────────────────────────────────────────┐
│ /dashboard/team                                               │
│ ├─ TeamAdminPanel (coordinator)                             │
│ │  ├─ TeamCreatorForm (create/edit teams)                  │
│ │  └─ TeamList (view/delete teams)                         │
│ └─ ProvisionUserForm (user provisioning)                    │
└───────────────────────────────────────────────────────────────┘

┌─ MANAGER TASK CREATION ────────────────────────────────────────┐
│ /dashboard/tasks                                              │
│ ├─ TaskComposer (create task form)                          │
│ │  ├─ Team selector (optional, if multi-team)             │
│ │  ├─ Title/description/instructions                      │
│ │  ├─ Validation rules picker                             │
│ │  │  └─ Only shows team-scoped rules                     │
│ │  ├─ Assignment mode selector                            │
│ │  │  ├─ "All team members"                               │
│ │  │  └─ "Selected members" (filtered to team)            │
│ │  └─ Deadline & late policy                              │
│ └─ [submit] → createTask()                                 │
└───────────────────────────────────────────────────────────────┘

┌─ DATA LAYER (lib/data.ts) ─────────────────────────────────────┐
│                                                                │
│  listTeams()              ← returns all teams                 │
│  listTeamMembers(profile) ← FILTERED by team_id              │
│  listRules(profile)       ← FILTERED by team_id              │
│  listTasksForManager()    ← FILTERED by team_id              │
│  listMyTasks()            ← FILTERED by assignee_id          │
│                                                                │
└───────────────────────────────────────────────────────────────┘

┌─ SERVER ACTIONS ──────────────────────────────────────────────┐
│                                                                │
│  ┌─ Teams (teams.ts)                                         │
│  │  ├─ createTeam()      [main_admin only]                 │
│  │  ├─ updateTeam()      [main_admin only]                 │
│  │  ├─ deleteTeam()      [main_admin only]                 │
│  │  └─ assignTeamManager()[main_admin only]                │
│  │                                                           │
│  ├─ Rules (rules.ts)                                        │
│  │  ├─ upsertRule()   [main_admin or manager + team check] │
│  │  └─ deleteRule()   [main_admin or manager + team check] │
│  │                                                           │
│  └─ Tasks (tasks.ts)                                         │
│     ├─ createTask()    [main_admin or manager + team check] │
│     └─ assignTask()    [main_admin or manager + team check] │
│                                                                │
└───────────────────────────────────────────────────────────────┘

┌─ DATABASE SCHEMA ─────────────────────────────────────────────┐
│                                                                │
│  teams                        validation_rules               │
│  ├─ id (UUID)                ├─ id (UUID)                   │
│  ├─ name (VARCHAR)           ├─ team_id (FK) ← KEY          │
│  ├─ description (TEXT)       ├─ rule_name (VARCHAR)         │
│  ├─ manager_id (FK)          ├─ prompt_template (TEXT)      │
│  └─ created_at               ├─ threshold (NUMERIC)         │
│                              ├─ weight (NUMERIC)            │
│  tasks                       ├─ enabled (BOOLEAN)           │
│  ├─ id (UUID)                └─ created_at                  │
│  ├─ team_id (FK) ← KEY                                      │
│  ├─ manager_id (FK)          profiles                       │
│  ├─ title (VARCHAR)          ├─ id (UUID)                   │
│  ├─ rule_ids (JSONB) ← NEW  ├─ team_id (FK) ← KEY         │
│  ├─ due_at (TIMESTAMP)       ├─ email (VARCHAR)             │
│  ├─ allow_late (BOOLEAN)     ├─ role (VARCHAR)              │
│  └─ created_at               └─ created_at                  │
│                                                                │
│  task_assignments                                             │
│  ├─ id (UUID)                                                │
│  ├─ task_id (FK)                                             │
│  ├─ assignee_id (FK)                                         │
│  └─ status (VARCHAR)                                         │
│                                                                │
│  RLS Policies:                                                │
│  - managers see only tasks.team_id = profile.team_id         │
│  - members see only task_assignments.assignee_id = profile.id│
│                                                                │
└───────────────────────────────────────────────────────────────┘
```

## Data Flow: Creating a Task

```
┌─────────────┐
│   Manager   │
│  fills out  │
│ task form   │
└──────┬──────┘
       │
       ├─ Team: "Frontend"
       ├─ Title: "Code Review"
       ├─ Rules: [rule-1, rule-3]  ← Selected from team's rules
       │         (not rule-2, rule-4, rule-5)
       ├─ Assignment: ["member-1", "member-2"]
       └─ Deadline: 2026-05-15
       │
       ▼
┌─────────────────────────────┐
│  createTask(formData)       │
├─────────────────────────────┤
│ 1. Verify role (manager)    │
│ 2. Parse form data          │
│ 3. Check canManageTeam()    │
│ 4. Insert tasks row:        │
│    ├─ team_id              │
│    ├─ rule_ids: [id1,id3]  │
│    └─ due_at               │
│ 5. Bulk insert assignments │
│    ├─ Verify member_ids    │
│    │  belong to team       │
│    └─ Create rows          │
│ 6. Log activity:           │
│    task.created            │
│ 7. Revalidate /tasks page  │
└─────────────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│  Database Updated           │
├─────────────────────────────┤
│ tasks row inserted:         │
│  ├─ id: task-123           │
│  ├─ team_id: team-A        │
│  ├─ rule_ids:              │
│  │  [                      │
│  │    "rule-1",            │
│  │    "rule-3"             │
│  │  ]                      │
│  └─ created_at: NOW        │
│                            │
│ task_assignments rows:     │
│  ├─ (task-123, member-1)  │
│  └─ (task-123, member-2)  │
└─────────────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│  Member submits file       │
├─────────────────────────────┤
│ 1. Fetch task:            │
│    rule_ids: [rule-1,3]   │
│ 2. For each rule_id:      │
│    ├─ Load rule config    │
│    ├─ Get prompt template │
│    └─ Send to OpenRouter  │
│ 3. Collect results        │
│ 4. Log validation_runs    │
│ 5. Update submission:     │
│    status = passed/failed │
└─────────────────────────────┘
```

## Permission Matrix

```
                    main_admin  manager  member
────────────────────────────────────────────────
VIEW TEAMS              ✓         own      ✗
CREATE TEAM             ✓         ✗        ✗
EDIT TEAM               ✓         ✗        ✗
DELETE TEAM             ✓         ✗        ✗
────────────────────────────────────────────────
LIST RULES             all        own      ✗
CREATE RULE            all        own      ✗
EDIT RULE              all        own      ✗
DELETE RULE            all        own      ✗
────────────────────────────────────────────────
LIST MEMBERS           all        own      ✗
PROVISION USER          ✓         ✗        ✗
────────────────────────────────────────────────
CREATE TASK            all        own      ✗
EDIT TASK              all        own      ✗
VIEW TASKS             all        own      own*
────────────────────────────────────────────────
SUBMIT TASK            ✗          ✗        own*

* member sees tasks assigned to them
* member can submit assigned tasks
```

## Team Scoping Example

### Before (Insecure)
```javascript
// Manager "Alice" with team_id="frontend"
// Fetches: SELECT * FROM validation_rules
// Result: ALL rules in system, including "backend" team's rules ❌
const rules = await listRules(profile)
// rules: [rule-1, rule-2, rule-3, rule-4, rule-5, ...]
```

### After (Secure)
```javascript
// Manager "Alice" with team_id="frontend"
// Fetches: SELECT * FROM validation_rules WHERE team_id = 'frontend'
// Result: Only Alice's team's rules ✓
const rules = await listRules(profile)
// rules: [rule-1, rule-2, rule-3]  (only frontend team rules)
```

## Activity Logging

All operations logged to `activity_log` table:

```
team.created
  ├─ actor_id: admin-1
  ├─ team_id: team-new
  ├─ action: "team.created"
  ├─ entity_type: "team"
  ├─ entity_id: team-new
  └─ metadata: { name: "QA Team" }

task.created
  ├─ actor_id: manager-1
  ├─ team_id: team-frontend
  ├─ action: "task.created"
  ├─ entity_type: "task"
  ├─ entity_id: task-123
  └─ metadata:
     ├─ title: "Code Review"
     ├─ assigned: 2
     └─ mode: "selected"

rule.updated
  ├─ actor_id: manager-1
  ├─ team_id: team-frontend
  ├─ action: "rule.updated"
  ├─ entity_type: "validation_rule"
  └─ entity_id: rule-42
```

## Component Hierarchy

```
dashboard/team/page.tsx (Server Component)
├─ Fetches profile, teams, managers
├─ If main_admin:
│  └─ <TeamAdminPanel>
│     ├─ <TeamCreatorForm>
│     │  ├─ createTeam() action
│     │  └─ updateTeam() action
│     └─ <TeamList>
│        └─ deleteTeam() action
└─ If manager:
   └─ <TeamMembers>
      └─ Team members view

dashboard/tasks/page.tsx (Server Component)
├─ Fetches profile, teams, members, rules
├─ <TaskComposer>
│  ├─ Team selector (multi-select)
│  ├─ Title/description inputs
│  ├─ AI instructions textarea
│  ├─ <ValidationRulesSection>
│  │  ├─ Rule checkboxes
│  │  └─ Select all / Clear all
│  ├─ Assignment mode selector
│  ├─ Member selector (filtered to team)
│  └─ createTask() action
└─ <TaskList>
   └─ taskId links to detail page
```

## Security Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  MAIN_ADMIN                                                 │
│  ├─ Can see ALL teams, rules, members, tasks               │
│  ├─ Can create/delete teams                                │
│  ├─ Can assign managers to teams                           │
│  └─ Can create tasks for any team                          │
│                                                              │
│  MANAGER (of "Frontend" team)                              │
│  ├─ Can see ONLY "Frontend" team resources                 │
│  ├─ Can create tasks ONLY for "Frontend"                  │
│  ├─ Can see ONLY "Frontend" members                        │
│  ├─ Can use ONLY "Frontend" validation rules              │
│  └─ Cannot create/delete teams                            │
│      └─ Security Error if attempted                        │
│                                                              │
│  MEMBER (of "Frontend" team)                               │
│  ├─ Can see ONLY their assigned tasks                     │
│  ├─ Can submit ONLY assigned tasks                        │
│  └─ Cannot see team management                            │
│      └─ 403 if URL directly accessed                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

All boundaries enforced at:
1. **Route level**: `requireRole()` in page/action
2. **Database query level**: `listRules()`, `listTeamMembers()` filtering
3. **Server action level**: `canManageTeam()` checks
4. **RLS level**: Supabase policies on sensitive tables
