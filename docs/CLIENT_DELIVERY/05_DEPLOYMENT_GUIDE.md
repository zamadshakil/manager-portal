# Environment & Deployment Guide

> **Client Delivery Document** | Part 5 of 6 | Version 2.0 | May 8, 2026

---

## 1. Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Node.js | 22+ | JavaScript runtime (matches `engines` in `package.json`) |
| pnpm | 9.15+ | Package manager |
| Git | Latest | Version control |
| Railway account | — | Hosts the app, self-hosted Supabase, and Redis |
| Cloudflare account | — | R2 object storage |
| OpenRouter account | — | LLM gateway (validation + Smart AI chat) |
| Brevo account | — | Transactional email |
| (Optional) OpenAI account | — | Higher-quality embeddings (falls back to OpenRouter if absent) |

---

## 2. Environment Variables (Complete Reference)

### Required Variables

| Variable | Source | Purpose |
|----------|--------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Self-hosted Supabase / Kong (Railway) | Public Supabase project URL — Kong public domain |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Self-hosted GoTrue | Public anonymous JWT (safe for client) |
| `SUPABASE_SERVICE_ROLE_KEY` | Self-hosted GoTrue | **Secret** admin JWT (server-only) |
| `OPENROUTER_API_KEY` | OpenRouter Dashboard | Powers validation pipeline **and** Smart AI chat |
| `R2_ACCOUNT_ID` | Cloudflare Dashboard → R2 | R2 account ID |
| `R2_ACCESS_KEY_ID` | Cloudflare R2 → API tokens | R2 access key |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 → API tokens | R2 secret key |
| `R2_BUCKET_NAME` | Cloudflare R2 | Bucket name |
| `R2_PUBLIC_URL` | Cloudflare R2 | Public URL prefix (e.g. `https://pub-xxx.r2.dev`) |
| `REDIS_URL` | Railway Redis plugin | Full ioredis connection URL (`redis://default:<pwd>@<host>:6379`) |
| `BREVO_API_KEY` | Brevo Dashboard | Transactional email API key |
| `BREVO_SENDER_EMAIL` | Brevo verified sender | Sender address |
| `BREVO_SENDER_NAME` | Self-defined | Sender display name |
| `CRON_SECRET` | Self-generated random string | Authenticates Railway cron requests |
| `NEXT_PUBLIC_SITE_URL` | `https://system.zamdevai.com` | Canonical public app URL — used for emails, OAuth redirects, CSRF checks, and OpenRouter referers |
| `NODE_ENV` | `production` | Standard Node env |

### Optional / Advanced Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `SMART_AI_MODEL` | `openai/gpt-4o-mini` | Smart AI chat model override |
| `DO_VALIDATION_MODEL` | `google/gemini-2.0-flash-001` | Rule validation model override |
| `DO_SUMMARY_MODEL` | `google/gemini-2.0-flash-001` | Summarisation model override |
| `DO_VISION_MODEL` | `google/gemini-2.0-flash-001` | Vision OCR model override |
| `EMBEDDING_MODEL` | `openai/text-embedding-3-small` | RAG chunk embedding model (1536-dim) |
| `OPENAI_API_KEY` | — | Preferred for embeddings; falls back to OpenRouter if unset |
| `SUPABASE_DB_URL` | — | **Recommended on Railway.** Direct Postgres URL for the RAG indexer (bypasses PostgREST schema-cache issues) |
| `LLM_CALL_TIMEOUT_MS` | `60000` | Per-LLM-call timeout |
| `LLM_RULE_CONCURRENCY` | `4` | Max concurrent rule evaluations |
| `PIPELINE_BUDGET_MS` | `50000` | Soft total pipeline time budget |

> **Why `SUPABASE_DB_URL`?** PostgREST's column-level schema cache has been unreliable on the self-hosted Supabase stack we run on Railway. Setting `SUPABASE_DB_URL` lets the RAG indexer talk to Postgres directly through the Postgres internal URL (e.g. `postgresql://postgres:<password>@postgres.railway.internal:5432/postgres`) and skip PostgREST entirely. Hit `GET /api/smart-ai/health` while signed in — if `direct_pg.status: "ok"` then RAG ingestion is bulletproof.

---

## 3. Local Development Setup

```bash
# 1. Clone the repository
git clone https://github.com/JobFlowAI/manager-portal.git
cd manager-portal

# 2. Install dependencies
pnpm install

# 3. Copy environment template
cp .env.local.example .env.local
# Edit .env.local with your team's credentials

# 4. Apply database migrations
#    Connect to the Railway Supabase Postgres in the SQL editor and run, in order:
#      scripts/001_init_schema.sql
#      scripts/002_helper_functions.sql
#      scripts/003_rls_policies.sql
#      scripts/004_seed_demo_data.sql       (optional)
#      scripts/005_tasks_and_late_submissions.sql
#      scripts/006_security_hardening_and_indexes.sql
#      scripts/006_expiration_for_materials.sql
#      scripts/007_rule_ids_and_delete_policy.sql
#      scripts/smart-ai-chat-followup.sql
#    Then everything in supabase/migrations/ in timestamp order.

# 5. Start the development server
pnpm dev
# App runs at http://localhost:3000
```

> **Note:** The AI validation pipeline runs **in-process** as a fire-and-forget async function. There is no separate background worker to start locally. Railway HTTP cron handles scheduled jobs in production.

---

## 4. Build & Production

```bash
pnpm build          # Production build (standalone output)
pnpm start          # Start the standalone server
pnpm lint           # ESLint check
```

### Build Output
- `output: "standalone"` produces a self-contained `.next/standalone/` bundle (Railway-friendly).
- Server Components pre-render at build time.
- Client Components are tree-shaken; `lucide-react`, `date-fns`, `recharts` use optimized imports.
- `serverExternalPackages` covers `unpdf`, `mammoth`, `officeparser` so they aren't pre-bundled.

---

## 5. Railway Deployment

### Project Layout

A single Railway project hosts every service the app needs:

| Service | Purpose |
|---------|---------|
| `manager-portal` | The Next.js app (this repo) |
| `postgres` | Supabase Postgres |
| `gotrue` | Supabase Auth |
| `postgrest` | Supabase REST API |
| `realtime` | Supabase Realtime (WebSocket) — used by messaging |
| `kong` | API gateway (public Supabase URL) |
| `redis` | Railway Redis plugin (referenced via `REDIS_URL`) |

### Step-by-Step

1. **Create a new Railway project** and add the services above (or fork an existing template).
2. **Connect the `manager-portal` repository** to the `manager-portal` service.
3. **Set environment variables** on the `manager-portal` service (all from Section 2). Reference `REDIS_URL` from the Redis plugin and the Supabase JWTs from the GoTrue / Kong services.
4. **Configure cron** — `railway.json` already declares the cron job. Railway invokes `GET /api/cron/mark-missed` every 15 minutes; `CRON_SECRET` authenticates the request.
5. **Deploy** — push to the connected branch. Railway runs `pnpm build` via Railpack and serves the standalone output.

### Railway Configuration (`railway.json`)

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": { "builder": "RAILPACK" },
  "deploy": {
    "startCommand": "node .next/standalone/server.js",
    "healthcheckPath": "/api/admin/health",
    "restartPolicyType": "ON_FAILURE"
  }
}
```

> The actual file in the repository is the source of truth — confirm the exact options before deploying.

### What Railway Provides

| Feature | Detail |
|---------|--------|
| Automatic HTTPS | TLS certificates managed for every public service |
| Internal networking | Services talk over `*.railway.internal` (no external traffic) |
| HTTP cron | Schedule `GET` calls to your own routes |
| Redis plugin | Persistent Redis with `REDIS_URL` reference variable |
| Logs / Metrics | Live log streaming + per-service metrics in the Railway dashboard |
| GitHub integration | Push to deploy with preview environments |

---

## 6. Infrastructure Architecture

```
┌───────────────────────── RAILWAY PROJECT ─────────────────────────┐
│                                                                    │
│   manager-portal (Next.js 16)                                     │
│   ├─ RSC pages + Server Actions                                   │
│   ├─ In-process AI pipeline                                       │
│   └─ Native Smart AI + Messaging APIs                             │
│            │           │           │            │                  │
│            ▼           ▼           ▼            ▼                  │
│      postgres ◄── postgrest    realtime ◄──── kong                 │
│         ▲          ▲              ▲            ▲                  │
│         └────── gotrue ───────────┴────────────┘                  │
│                                                                    │
│   redis  ── REDIS_URL referenced by manager-portal                 │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
                │                                   │
                ▼                                   ▼
       ┌────────────────┐                  ┌─────────────────┐
       │ Cloudflare R2  │                  │ OpenRouter      │
       │  (S3 API)      │                  │  Gemini 2.0     │
       │  Submissions   │                  │  GPT-4o-mini    │
       │  Materials     │                  │  Vision OCR     │
       │  Chat docs     │                  └─────────────────┘
       │  Messaging     │
       └────────────────┘
                                           ┌─────────────────┐
                                           │ Brevo (email)   │
                                           └─────────────────┘
```

### Service Dependencies

| Service | Region | Notes |
|---------|--------|-------|
| Railway | Configurable | Hosts every server-side component except R2 / OpenRouter / Brevo |
| Cloudflare R2 | Global edge | S3-compatible, no egress fees |
| OpenRouter | Provider's region | Routes to Gemini / OpenAI / etc. |
| Brevo | EU | Transactional email |

---

## 7. Security Hardening Checklist

| ✅ | Security Measure | Implementation |
|----|-----------------|----------------|
| ✅ | HTTPS enforced | HSTS header with 2-year max-age |
| ✅ | Content Security Policy | Strict CSP with whitelisted domains |
| ✅ | Frame protection | `X-Frame-Options: DENY` |
| ✅ | Content sniffing protection | `X-Content-Type-Options: nosniff` |
| ✅ | Referrer policy | `strict-origin-when-cross-origin` |
| ✅ | Permissions policy | Camera, mic, geolocation disabled |
| ✅ | Row-Level Security | RLS on every table including messaging tables |
| ✅ | Input validation | Zod schemas on every mutation |
| ✅ | Rate limiting | Upload, LLM, chat, and messaging limiters (Railway Redis sliding window) |
| ✅ | Idempotency locks | Per-submission Redis SETNX lock prevents double-processing |
| ✅ | Audit logging | Every action logged with IP + user agent + actor |
| ✅ | Private file storage | R2 access only via authenticated download proxy |
| ✅ | Service role isolation | Admin client used only server-side; `import "server-only"` enforces it |
| ✅ | Cron authentication | `CRON_SECRET` bearer token |
| ✅ | Provision-only onboarding | No public sign-up; `must_reset` flag forces first-login password change |
| ✅ | Email-change verification | Token-based confirmation flow under `/auth/confirm-email-change` |

---

## 8. Monitoring & Observability

| What | Where | How |
|------|-------|-----|
| Application errors | Railway service logs | Live log streaming on the `manager-portal` service |
| Web performance | `/api/vitals` | Core Web Vitals (LCP, FID, CLS) reported by `components/web-vitals-reporter.tsx` |
| Cron execution history | Railway Redis | List key `cron:mark-missed:executions` (last 100 entries) |
| Pipeline performance | `submissions.metadata.timing` | Parse, rules, summary latency per submission |
| Rate limit analytics | Railway Redis | Sliding-window keys per limiter |
| AI model performance | `validation_runs` table | `latency_ms`, `tokens_in`, `tokens_out` per run |
| AI credit consumption | `ai_usage_log` + `/dashboard/ai-usage` | Per-user, per-action token + credit accounting |
| Activity audit trail | `/dashboard/activity` page | Actor, action, entity, timestamp, IP |
| Smart AI health | `GET /api/smart-ai/health` | Reports DB, OpenRouter, R2, embedding-model and `direct_pg` / `postgrest` status |

---

*Next: [06 — Presentation Talking Points](./06_PRESENTATION_GUIDE.md)*
