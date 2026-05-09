# Hierarchia Manager Portal — Deployment Checklist

**Platform:** Railway (all services in a single project)
**Last Updated:** May 8, 2026

---

## Railway Services Overview

| Service | Type | Purpose |
|---------|------|---------|
| **manager-portal** | Next.js 16 (Railpack) | Main app — includes native Smart AI (chat, RAG, analytics) |
| **Supabase** | Self-hosted stack | Database, Auth, Storage, Realtime |
| **Kong** | API Gateway | Supabase public URL |
| **Postgres** | PostgreSQL + pgvector | Primary database |
| **GoTrue Auth** | Auth server | Supabase authentication |

> **Note:** The `mcp-service` and `FastAPI-8UVj` (`rag-service`) Railway
> deployments have been **decommissioned**. All Smart AI orchestration now
> runs inside `manager-portal` and talks to Supabase + pgvector directly.
> Delete those two Railway services after this deploy succeeds.

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

- [x] All foundational migrations applied (`scripts/001–007` + `smart-ai-chat-followup.sql`)
- [x] All incremental migrations applied (`supabase/migrations/20260501–-20260512`)
- [x] pgvector extension enabled
- [x] `rag_documents` table with HNSW index
- [x] `chat_threads`, `chat_messages`, `chat_documents` tables
- [x] `ai_credit_limits`, `ai_usage_log` tables
- [x] `conversations`, `conversation_members`, `messages`, `message_reactions` tables
- [x] RLS enabled on all tables
- [x] Realtime publication includes `messages`, `message_reactions`, `conversation_members`
- [x] Triggers: `handle_new_user`, `touch_updated_at`, `bump_thread_updated_at`, `bump_conversation_updated_at`, `rag_documents_tsv_update`

### UI/UX

- [x] All form fields have proper labels and help text
- [x] Error messages display clearly (toast notifications via Sonner)
- [x] Success messages confirm operations
- [x] Buttons disabled during async operations (loading states)
- [x] Mobile responsive design with bottom nav
- [x] Accessible markup with ARIA labels
- [x] Smart AI chat with tool-call rendering
- [x] Department management CRUD
- [x] Messaging UI (DMs + groups, typing, reactions, replies, attachments)

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
| `REDIS_URL` | [ ] | Railway Redis — rate limiting, idempotency locks, cron observability (reference variable from the Redis plugin) |
| `OPENAI_API_KEY` | [ ] | Optional — preferred for embeddings (falls back to OpenRouter) |
| `EMBEDDING_MODEL` | [ ] | Defaults to `openai/text-embedding-3-small` |
| `SMART_AI_MODEL` | [ ] | Defaults to `openai/gpt-4o-mini` |
| `BREVO_API_KEY` | [ ] | Transactional emails |
| `BREVO_SENDER_EMAIL` | [ ] | Sender address |
| `CRON_SECRET` | [ ] | Cron endpoint auth |
| `NEXT_PUBLIC_SITE_URL` | [ ] | `https://system.zamdevai.com` |
| `NODE_ENV` | [ ] | `production` |
| `SUPABASE_DB_URL` | [ ] | Optional — direct Postgres for RAG indexer |

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

### 4. Configure Railway Cron
1. In Railway dashboard, set up a cron job for the manager-portal service
2. Schedule: every 15 minutes (`*/15 * * * *`)
3. Endpoint: `GET /api/cron/mark-missed`
4. Header: `Authorization: Bearer $CRON_SECRET`

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
- [ ] Submission triggers in-process async pipeline
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

### Messaging

- [ ] `/dashboard/messages` loads and lists conversations
- [ ] Can start a new DM with another user
- [ ] Can create a group conversation and add members
- [ ] Sending a message appears in real time on a second client (Supabase Realtime)
- [ ] Typing indicators show / clear correctly
- [ ] Reactions, replies, edit, soft-delete all work
- [ ] File / image attachments upload via `/api/messaging/upload` and render in the message list
- [ ] Unread counts update from `last_read_at`
- [ ] RLS prevents reading conversations the user is not a member of

### Department Management

- [ ] Admin can view all departments
- [ ] Admin can create new departments
- [ ] Admin can edit department details
- [ ] Admin can assign/remove members
- [ ] Admin can assign managers
- [ ] Cannot delete departments with active tasks

### Scheduled Jobs (Railway HTTP Cron)

- [ ] Railway cron hits `/api/cron/mark-missed` every 15 minutes
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

### Cron Job Monitoring
- Verify cron execution in Railway logs (search for `[cron] mark-missed completed`)
- Check Upstash Redis for execution tracking via `lib/upstash-scheduler.ts`
- Monitor for missed cron runs

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
3. **No realtime submission status** — Members must refresh to see pipeline progress (messaging uses realtime, but submissions do not yet)
4. **No PDF report export** — CSV export available for some data
5. **`database.types.ts` is a stub** — Using `Database = any` shim

---

**Deployed By:** [TO BE FILLED]
**Deploy Date:** [TO BE FILLED]
**Verified By:** [TO BE FILLED]
