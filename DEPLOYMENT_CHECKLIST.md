# Task & Team Management System - Deployment Checklist

## Pre-Deployment Verification

### Code Quality

- [x] All new TypeScript code passes type checking
- [x] No unused imports or variables
- [x] All server actions use `"use server"` directive
- [x] All form inputs validated with Zod schemas
- [x] Error messages are user-friendly (no database leakage)
- [x] Console errors replaced with structured logging

### Security

- [x] All endpoints require role verification via `requireRole()`
- [x] Team ownership verified via `canManageTeam()` where applicable
- [x] listRules() filters by team_id for managers
- [x] listTeamMembers() filters by team_id for managers
- [x] No SQL injection vectors (using Supabase client)
- [x] RLS policies configured on database
- [x] Activity logging enabled for all modifications

### Database

- [x] Schema includes team_id foreign keys
- [x] tasks.rule_ids column exists (JSONB type)
- [x] teams table has manager_id column
- [x] All tables have proper constraints and indexes
- [x] RLS policies active on: tasks, validation_rules, profiles, submissions

### UI/UX

- [x] All form fields have proper labels and help text
- [x] Error messages display clearly
- [x] Success messages confirm operations
- [x] Buttons disabled during async operations (loading states)
- [x] Mobile responsive design maintained
- [x] Accessible markup with ARIA labels

---

## Local Testing (Before Staging)

### Team Management

- [ ] Log in as main_admin
- [ ] Navigate to `/dashboard/team`
- [ ] Create a new team "Test Team"
  - [ ] Form validates team name (required, 2-100 chars)
  - [ ] Description is optional
  - [ ] Manager dropdown populated with managers
  - [ ] Success message appears
- [ ] Edit team name
  - [ ] Form populated with current values
  - [ ] Changes saved immediately
  - [ ] Cancel button clears edit state
- [ ] Delete empty team
  - [ ] Confirmation dialog shown
  - [ ] Team removed from list
  - [ ] Team removed from task composer dropdown
- [ ] Attempt to delete team with tasks
  - [ ] Error message shown: "Cannot delete team with active tasks"
  - [ ] Team remains in list

### Task Creation

- [ ] Log in as manager
- [ ] Navigate to `/dashboard/tasks`
- [ ] Create task for own team
  - [ ] Team selector shows only own team
  - [ ] Member selector shows only own team members
  - [ ] Rules selector shows only own team's rules
  - [ ] All controls work correctly
- [ ] Assign to all members
  - [ ] Task created with all team members assigned
  - [ ] Activity log shows correct assignment count
- [ ] Assign to specific members
  - [ ] Task created with selected members only
  - [ ] Other team members not assigned

### Rule Selection

- [ ] Create task with all rules selected
  - [ ] task.rule_ids stored with all IDs
  - [ ] Member submission validated against all rules
- [ ] Create task with specific rules selected
  - [ ] task.rule_ids stored with only selected IDs
  - [ ] Member submission validated against selected rules only
- [ ] Create task with no rules selected
  - [ ] task.rule_ids stored as empty array []
  - [ ] Member submission skips all standing rules
  - [ ] Warning shown: "No standing rules selected"

### Authorization

- [ ] Log in as manager of Team A
  - [ ] Cannot see Team B's tasks (403)
  - [ ] Cannot create task for Team B
  - [ ] Cannot see Team B's rules in dropdown
  - [ ] Cannot see Team B's members in dropdown
- [ ] Log in as main_admin
  - [ ] Can see all teams
  - [ ] Can create tasks for any team
  - [ ] Can see all rules/members in dropdowns
- [ ] Log in as team member
  - [ ] Cannot access `/dashboard/team` (redirect or 403)
  - [ ] Cannot see task creation form
  - [ ] Can see and submit only assigned tasks

---

## Staging Deployment

### Pre-Deploy Steps

```bash
# 1. Create feature branch from main
git checkout main
git pull origin main
git checkout -b feature/task-team-management

# 2. Merge all changes
git merge v0/zamadshakil-1740964f

# 3. Run type check
pnpm type-check

# 4. Build project
pnpm build

# 5. Run linter
pnpm lint

# 6. Commit changes
git add .
git commit -m "feat: task & team management system

- Implement team CRUD (create, read, update, delete)
- Add per-task validation rule selection
- Scope data layer queries by team_id
- Strengthen permission checks in rules action
- Add team management UI components
- Comprehensive audit of logical flows"

# 7. Push to GitHub
git push origin feature/task-team-management

# 8. Create pull request on GitHub
```

### Staging Tests

On staging environment:

- [ ] Fresh team creation works end-to-end
- [ ] Task creation and assignment functions
- [ ] Rule selection applies correctly to submissions
- [ ] Permission boundaries respected between teams
- [ ] Activity log entries created for all operations
- [ ] No console errors or warnings
- [ ] Database transactions complete successfully
- [ ] Revalidation triggers and clears stale cache

---

## Production Deployment

### Final Checklist

- [ ] All staging tests passed
- [ ] Code review approved
- [ ] Database backup taken
- [ ] Team notified of deployment
- [ ] Deployment window scheduled (off-peak recommended)
- [ ] Rollback plan documented

### Deployment Steps

```bash
# 1. Merge PR to main
# (via GitHub UI or CLI)

# 2. Wait for CI/CD to complete
# (Vercel should auto-deploy)

# 3. Monitor deployment logs
# (check for any errors)

# 4. Test on production
# (create test team, verify scoping)

# 5. Notify team
# (deployment complete, new features available)
```

### Post-Deployment Verification

- [ ] main_admin can create teams
- [ ] Managers can create tasks for own team
- [ ] Rule selection works correctly
- [ ] Cross-team access is blocked
- [ ] Activity logs record all operations
- [ ] No error messages in browser console
- [ ] Performance acceptable (queries < 1s)

---

## Rollback Plan (if needed)

```bash
# 1. Identify problematic commit
git log --oneline main | head -20

# 2. Revert changes
git revert <commit-hash>

# 3. Push to main
git push origin main

# 4. Verify Vercel redeploys previous version

# 5. Restore from database backup if needed
```

---

## Known Issues & Limitations

### Current Limitations

1. **No bulk rule reassignment** — Must update task rule_ids manually or via bulk API
2. **No team archiving** — Can only delete empty teams (consider adding soft-delete)
3. **No manager transition workflow** — Changing managers doesn't notify them automatically
4. **No rule templates** — Each team creates rules from scratch

### Planned Improvements

- [ ] Implement team archiving (status: active/archived)
- [ ] Add rule templates/library shared across teams
- [ ] Build manager reassignment workflow
- [ ] Add team-level notifications
- [ ] Create audit log viewer UI

---

## Support & Documentation

### Files to Share with Team

1. `docs/TASK_TEAM_MANAGEMENT_AUDIT.md` — Technical details and testing checklist
2. `docs/IMPLEMENTATION_SUMMARY.md` — Quick reference guide
3. `docs/ARCHITECTURE_DIAGRAM.md` — Visual system architecture
4. `DEPLOYMENT_CHECKLIST.md` — This file

### FAQ

**Q: Can a manager see other teams' rules?**
A: No, `listRules()` is team-scoped for managers.

**Q: What happens if a manager is assigned to a new team?**
A: Their `profile.team_id` is updated, and they immediately see the new team's rules/members.

**Q: Can I change a task's rules after creation?**
A: Currently no, but the API supports bulk updates if needed.

**Q: What if I delete a team with active tasks?**
A: The delete operation will fail with an error message; you must archive or complete tasks first.

**Q: Are all operations logged?**
A: Yes, all team/task/rule modifications are logged to the activity_log table.

---

## Success Criteria

Deployment is successful when:

1. ✓ Admins can create and manage teams
2. ✓ Managers can create tasks and select team-specific rules
3. ✓ Members cannot see other teams' data
4. ✓ All operations are logged
5. ✓ No security vulnerabilities detected
6. ✓ Performance is acceptable (< 1 second response times)
7. ✓ Zero data loss or corruption

---

## Contact & Escalation

If issues arise:

1. Check logs in Vercel dashboard
2. Review error messages in console
3. Consult `TASK_TEAM_MANAGEMENT_AUDIT.md` for troubleshooting
4. Rollback if necessary (see rollback plan above)
5. Open GitHub issue with logs and reproduction steps

---

**Deployment Date:** [TO BE FILLED]
**Deployed By:** [TO BE FILLED]
**Approved By:** [TO BE FILLED]
