# Hierarchia Manager Portal — Deployment Checklist

**Platform:** Railway (all services in a single project)
**Last Updated:** May 5, 2026

---

## Railway Services Overview

| Service | Type | Purpose |
|---------|------|---------|
| **manager-portal** | Next.js 16 (Railpack) | Main application |
| **mcp-service** | Node.js | MCP chat orchestration |
| **FastAPI-8UVj** | Python/FastAPI | RAG analytics |
| **Supabase** | Self-hosted stack | Database, Auth, Storage, Realtime |
| **Kong** | API Gateway | Supabase public URL |
| **Postgres** | PostgreSQL + pgvector | Primary database |
| **GoTrue Auth** | Auth server | Supabase authentication |

---

## Pre-Deployment Verification

### Code Quality

- [x] All TypeScript code passes type checking
- [x] No unused imports or variables
- [x] All server actions use `"use server"` directive
- [x] All form inputs validated with Zod schemas
- [x] Error messages are user-friendly (no database leakage)
- [x] `server-only` imports on all sensitive modules

### Security

- [x] All endpoints require role verification via `requireRole()`
- [x] Team ownership verified via `canManageTeam()` where applicable
- [x] `listRules()` filters by team_id for managers
- [x] `listTeamMembers()` filters by team_id for managers
- [x] No SQL injection vectors (using Supabase client)
- [x] RLS policies configured on all database tables
- [x] Activity logging enabled for all modifications
- [x] Security headers in `next.config.mjs` (HSTS, CSP, X-Frame-Options DENY)
- [x] Chat thread RLS (per-user only)
- [x] RAG document RLS (role-based scoping)

### Database (Railway Postgres)

- [x] All migrations applied (001–009 + RAG + chat schema)
- [x] pgvector extension enabled
- [x] `rag_documents` table with HNSW index
- [x] `chat_threads`, `chat_messages`, `chat_documents` tables
- [x] `ai_credit_limits`, `ai_usage_log` tables
- [x] RLS enabled on all tables
- [x] Triggers: `handle_new_user`, `touch_updated_at`, `bump_thread_updated_at`, `rag_documents_tsv_update`

### UI/UX

- [x] All form fields have proper labels and help text
- [x] Error messages display clearly (toast notifications via Sonner)
- [x] Success messages confirm operations
- [x] Buttons disabled during async operations (loading states)
- [x] Mobile responsive design with bottom nav
- [x] Accessible markup with ARIA labels
- [x] Smart AI chat with tool-call rendering
- [x] Department management CRUD

---

## Environment Variables Checklist

### manager-portal (Railway)

| Variable | Set? | Notes |
|----------|------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | [ ] | Kong public domain |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | [ ] | JWT signed by self-hosted GoTrue |
| `SUPABASE_SERVICE_ROLE_KEY` | [ ] | Service-role JWT |
| `OPENROUTER_API_KEY` | [ ] | Powers chat + embeddings + validation |
| `R2_ACCOUNT_ID` | [ ] | Cloudflare R2 |
| `R2_ACCESS_KEY_ID` | [ ] | Cloudflare R2 |
| `R2_SECRET_ACCESS_KEY` | [ ] | Cloudflare R2 |
| `R2_BUCKET_NAME` | [ ] | Cloudflare R2 |
| `R2_PUBLIC_URL` | [ ] | Cloudflare R2 |
| `UPSTASH_REDIS_REST_URL` | [ ] | Rate limiting + cron |
| `UPSTASH_REDIS_REST_TOKEN` | [ ] | Rate limiting + cron |
| `INNGEST_EVENT_KEY` | [ ] | From Inngest Cloud |
| `INNGEST_SIGNING_KEY` | [ ] | From Inngest Cloud |
| `MCP_SERVICE_URL` | [ ] | Private Railway URL |
| `MCP_SERVICE_TOKEN` | [ ] | Shared secret |
| `RAG_SERVICE_URL` | [ ] | Private Railway URL |
| `RAG_SERVICE_TOKEN` | [ ] | Shared secret |
| `BREVO_API_KEY` | [ ] | Transactional emails |
| `BREVO_SENDER_EMAIL` | [ ] | Sender address |
| `CRON_SECRET` | [ ] | Cron endpoint auth |
| `NEXT_PUBLIC_SITE_URL` | [ ] | Public portal URL |
| `NODE_ENV` | [ ] | `production` |

### mcp-service (Railway)

| Variable | Set? | Notes |
|----------|------|-------|
| `SUPABASE_URL` | [ ] | Same as portal's SUPABASE_URL |
| `SUPABASE_SERVICE_ROLE_KEY` | [ ] | Required for persistence |
| `MCP_SERVICE_TOKEN` | [ ] | Same shared secret |
| `RAG_SERVICE_URL` | [ ] | For searchDocument tool |
| `RAG_SERVICE_TOKEN` | [ ] | Same shared secret |
| `OPENROUTER_API_KEY` | [ ] | LLM provider |

### FastAPI-8UVj (Railway)

| Variable | Set? | Notes |
|----------|------|-------|
| `DATABASE_URL` | [ ] | Railway Postgres connection string |
| `RAG_SERVICE_TOKEN` | [ ] | Auth token |

---

## Deployment Steps

### 1. Push to GitHub
```bash
git add .
git commit -m "feat: <description>"
git push origin main
```

### 2. Railway Auto-Deploys
Railway monitors the `main` branch and auto-deploys on push. Monitor the deploy logs in Railway dashboard.

### 3. Run Migrations (if schema changed)
1. Open Supabase Studio on Railway
2. Navigate to SQL Editor
3. Paste and execute any new migration files
4. Verify with `\dt` or table browser

### 4. Verify Inngest Registration
1. Check Inngest Cloud dashboard
2. Verify the `/api/inngest` endpoint is registered
3. Confirm functions are discovered:
   - `process-submission`
   - `handle-submission-failure`
   - `mark-missed-cron`

---

## Post-Deployment Verification

### Core Functionality

- [ ] Login works (email + password via GoTrue)
- [ ] Forgot password flow works
- [ ] First-login password reset gate works
- [ ] Dashboard loads with correct role-based views
- [ ] Navigation works (sidebar, mobile nav, tabs)

### Task Management

- [ ] Admin can create teams/departments
- [ ] Manager can create tasks for own team
- [ ] Manager can assign tasks to specific or all members
- [ ] Member sees assigned tasks
- [ ] Member can submit documents (PDF, DOCX, PPTX, images)
- [ ] Submission triggers Inngest pipeline
- [ ] Pipeline processes: parsing → validating → scored → passed/failed
- [ ] Late submission flow works with reason

### Smart AI

- [ ] Smart AI chat loads
- [ ] Chat sends messages and receives streaming responses
- [ ] Tool calls work (queryDatabase returns real data)
- [ ] Document search tool works (searchDocument)
- [ ] Chat threads persist and appear in history
- [ ] File upload works (to R2 → indexed in pgvector)
- [ ] AI credit limits are enforced

### Department Management

- [ ] Admin can view all departments
- [ ] Admin can create new departments
- [ ] Admin can edit department details
- [ ] Admin can assign/remove members
- [ ] Admin can assign managers
- [ ] Cannot delete departments with active tasks

### Background Jobs

- [ ] 15-minute cron fires via Inngest
- [ ] Missed assignments are marked correctly
- [ ] Stuck submissions are recovered
- [ ] Expired announcements are deleted
- [ ] Expired materials are deleted (+ R2 blobs + RAG index)

### Other Features

- [ ] Announcements CRUD (team-scoped + global)
- [ ] Materials CRUD with file upload/download
- [ ] Validation rules CRUD
- [ ] Reports chart renders
- [ ] Activity log shows operations
- [ ] AI usage dashboard shows credit consumption
- [ ] Authenticated download proxy works
- [ ] Welcome email sends on user provisioning

---

## Rollback Plan (if needed)

```bash
# 1. Identify problematic commit
git log --oneline main -10

# 2. Revert changes
git revert <commit-hash>

# 3. Push to main (Railway auto-redeploys)
git push origin main

# 4. If database migration caused issues:
#    - Restore from Railway Postgres backup
#    - Or apply a reverse migration SQL
```

---

## Monitoring

### Railway Dashboard
- Check service status (all services should show "Online")
- Monitor deploy logs for errors
- Check memory/CPU usage

### Inngest Dashboard
- Monitor function execution history
- Check for failed runs (auto-retried up to 3 times)
- Verify cron schedule fires every 15 minutes

### Application Health
```bash
# Check Smart AI health
curl https://<portal-url>/api/smart-ai/health

# Check cron endpoint
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://<portal-url>/api/cron/mark-missed
```

---

## Known Limitations

1. **No bulk rule reassignment** — Must update task `rule_ids` manually
2. **No team archiving** — Can only delete empty teams
3. **No realtime submission status** — Members must refresh to see pipeline progress
4. **No PDF report export** — CSV export available for some data
5. **`database.types.ts` is a stub** — Using `Database = any` shim

---

**Deployed By:** [TO BE FILLED]
**Deploy Date:** [TO BE FILLED]
**Verified By:** [TO BE FILLED]
