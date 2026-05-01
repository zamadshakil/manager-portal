# Environment & Deployment Guide

> **Client Delivery Document** | Part 5 of 6

---

## 1. Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Node.js | 18+ | JavaScript runtime |
| pnpm (or npm/yarn) | Latest | Package manager |
| Git | Latest | Version control |
| Supabase account | — | Database + Auth |
| Upstash account | — | Redis (rate limiting) |
| DigitalOcean account | — | AI Inference API |
| Vercel account | — | Deployment platform |

---

## 2. Environment Variables (Complete Reference)

### Required Variables

| Variable | Source | Purpose |
|----------|--------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard → Settings → API | Public Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API | Public anonymous key (safe for client) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Settings → API | **Secret** admin key (server-only) |
| `UPSTASH_REDIS_REST_URL` | Upstash Console → Database details | Redis REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Console → Database details | Redis authentication token |
| `DO_AI_API_KEY` | DigitalOcean → API → Tokens | AI Inference API key |
| `CRON_SECRET` | Self-generated (any secure random string) | Authenticates cron job requests |
| `BLOB_READ_WRITE_TOKEN` | Vercel Dashboard → Storage → Blob | File storage authentication |

### Optional Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `DO_AI_BASE_URL` | `https://inference.do-ai.run/v1` | Custom AI inference endpoint |
| `DO_VALIDATION_MODEL` | `deepseek-3.2` | Text validation model override |
| `DO_SUMMARY_MODEL` | `deepseek-3.2` | Summarization model override |
| `DO_VISION_MODEL` | `nemotron-nano-12b-v2-vl` | Vision/OCR model override |
| `LLM_CALL_TIMEOUT_MS` | `60000` | Per-LLM-call timeout (ms) |
| `LLM_RULE_CONCURRENCY` | `4` | Max concurrent rule evaluations |
| `PIPELINE_BUDGET_MS` | `50000` | Total pipeline time budget (ms) |
| `INNGEST_EVENT_KEY` | — | Inngest cloud event key (production) |
| `INNGEST_SIGNING_KEY` | — | Inngest cloud signing key (production) |

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
# Edit .env.local with your actual credentials

# 4. Set up the database
# Run migrations in order in the Supabase SQL Editor:
#   scripts/001_init_schema.sql
#   scripts/002_helper_functions.sql
#   scripts/003_rls_policies.sql
#   scripts/004_seed_demo_data.sql  (optional — demo data)
#   scripts/005_tasks_and_late_submissions.sql
#   scripts/006_security_hardening_and_indexes.sql
#   scripts/007_rule_ids_and_delete_policy.sql

# 5. Start the development server
pnpm dev
# App runs at http://localhost:3000

# 6. Start Inngest dev server (separate terminal)
npx inngest-cli@latest dev
# Inngest dashboard at http://localhost:8288
```

---

## 4. Build & Production

```bash
# Build for production
pnpm build

# Start production server
pnpm start

# Lint check
pnpm lint
```

### Build Output
- Server Components pre-render at build time
- Client Components bundled with tree-shaking
- Optimized imports for `lucide-react`, `date-fns`, `recharts`
- Server external packages: `unpdf`, `mammoth`, `officeparser`, `tesseract.js`

---

## 5. Vercel Deployment

### Step-by-Step

1. **Connect repository** at [vercel.com/new](https://vercel.com/new)
2. **Set environment variables** in Vercel project settings (all from Section 2)
3. **Enable Vercel Blob** in Storage settings
4. **Deploy** — automatic on every push to `main`

### Vercel Configuration (`vercel.json`)

```json
{
  "crons": [
    {
      "path": "/api/cron/mark-missed",
      "schedule": "0 0 * * *"
    }
  ]
}
```

> **Note:** Hobby plan supports daily cron only. Upgrade to Pro for 15-minute intervals: `"schedule": "*/15 * * * *"`

### What Vercel Provides

| Feature | Detail |
|---------|--------|
| Automatic HTTPS | SSL certificates managed automatically |
| CDN | Static assets cached at edge locations worldwide |
| Serverless Functions | Each API route runs as an independent function |
| Preview Deployments | Every PR gets its own preview URL |
| Blob Storage | Managed file storage with private access |
| Analytics | Web Vitals monitoring (LCP, FID, CLS) |
| Cron Jobs | Scheduled function execution |

---

## 6. Infrastructure Architecture

```
┌──────────────────────────────────────────────────────┐
│                    VERCEL (Hosting)                    │
│  ┌─────────────┐  ┌───────────┐  ┌───────────────┐  │
│  │ Edge Network│  │ Serverless│  │  Blob Storage │  │
│  │ (CDN + MW)  │  │ Functions │  │  (Documents)  │  │
│  └──────┬──────┘  └─────┬─────┘  └───────────────┘  │
│         │               │                            │
└─────────┼───────────────┼────────────────────────────┘
          │               │
    ┌─────┼───────────────┼─────────────────────┐
    │     │               │                     │
    ▼     ▼               ▼                     ▼
┌────────────┐  ┌──────────────┐  ┌──────────────────┐
│  Supabase  │  │   Upstash    │  │  DigitalOcean    │
│  (AWS)     │  │   (AWS)      │  │  AI Inference    │
│            │  │              │  │                  │
│ PostgreSQL │  │ Redis        │  │ DeepSeek V3      │
│ Auth       │  │ Rate Limit   │  │ Nemotron VL      │
│ RLS        │  │ Locks        │  │ (OpenAI-compat)  │
└────────────┘  └──────────────┘  └──────────────────┘
```

### Service Dependencies

| Service | Region | Redundancy | SLA |
|---------|--------|------------|-----|
| Vercel | Global Edge | Multi-region | 99.99% |
| Supabase | AWS (configurable) | Managed backups | 99.9% |
| Upstash Redis | AWS (configurable) | Multi-region replication | 99.99% |
| DigitalOcean AI | US East | API-level redundancy | 99.9% |

---

## 7. Security Hardening Checklist

| ✅ | Security Measure | Implementation |
|----|-----------------|----------------|
| ✅ | HTTPS enforced | HSTS header with 2-year max-age |
| ✅ | Content Security Policy | Strict CSP with whitelisted domains |
| ✅ | Frame protection | X-Frame-Options: DENY |
| ✅ | Content sniffing protection | X-Content-Type-Options: nosniff |
| ✅ | Referrer policy | strict-origin-when-cross-origin |
| ✅ | Permissions policy | Camera, mic, geolocation disabled |
| ✅ | Row-Level Security | RLS on every table |
| ✅ | Input validation | Zod schemas on every mutation |
| ✅ | Rate limiting | Upload + LLM rate limiters |
| ✅ | Audit logging | Every action logged with IP + user agent |
| ✅ | Private file storage | Vercel Blob with signed access |
| ✅ | Service role isolation | Admin client used only server-side |
| ✅ | Cron authentication | CRON_SECRET bearer token |
| ✅ | Password reset flow | must_reset flag for provisioned users |
| ✅ | Server-only imports | `import "server-only"` on sensitive modules |

---

## 8. Monitoring & Observability

| What | Where | How |
|------|-------|-----|
| Application errors | Vercel Dashboard → Functions | Serverless function logs |
| Web performance | Vercel Analytics | Core Web Vitals (LCP, FID, CLS) |
| Cron execution history | Upstash Redis Console | `cron:mark-missed:executions` list |
| Pipeline performance | Submission `metadata.timing` | Parse, rules, summary latency per submission |
| Rate limit analytics | Upstash Dashboard | Upload + LLM limiter analytics |
| AI model performance | `validation_runs` table | `latency_ms`, `tokens_in`, `tokens_out` per run |
| Activity audit trail | `/dashboard/activity` page | Actor, action, entity, timestamp, IP |
| Background job status | Inngest Dashboard | Job history, retries, step execution |

---

*Next: [06 — Presentation Talking Points](./06_PRESENTATION_GUIDE.md)*
