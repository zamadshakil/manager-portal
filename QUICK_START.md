# Quick Start Guide — Manager Portal

Get the portal running locally in **5 minutes**.

## Prerequisites
- Node.js 18+
- Git
- Credentials (typically supplied by your team lead): Supabase, Upstash Redis, Upstash QStash, Vercel Blob, Google Gemini, CRON_SECRET

## Setup

```bash
# 1. Clone repo
git clone https://github.com/JobFlowAI/manager-portal.git
cd manager-portal

# 2. Install dependencies
pnpm install

# 3. Set up environment
cp .env.local.example .env.local
# Edit .env.local and add your actual credentials.

# 4. Run database migrations
#    Open Supabase SQL editor and run scripts/001..005 in order.

# 5. Start dev server
pnpm dev

# 6. Open browser
open http://localhost:3000
```

## Key URLs

- **App:** http://localhost:3000
- **Living architecture spec:** [docs/PROJECT_STATUS.md](./docs/PROJECT_STATUS.md)
- **Pipeline deep dive:** [docs/PIPELINE_ARCHITECTURE.md](./docs/PIPELINE_ARCHITECTURE.md)
- **Supabase console:** https://supabase.com (your project)
- **Upstash console:** https://console.upstash.com (Redis + QStash)

## Environment variables (annotated reference)

The complete reference lives in `.env.local.example`. For local dev you minimally need:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Storage
BLOB_READ_WRITE_TOKEN=...

# Cache + idempotency
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...

# AI
GOOGLE_GENERATIVE_AI_API_KEY=...

# Cron auth
CRON_SECRET=...
```

For **production-like local testing of the pipeline queue**, also set:

```env
QSTASH_TOKEN=...
QSTASH_CURRENT_SIGNING_KEY=...
QSTASH_NEXT_SIGNING_KEY=...
APP_URL=http://localhost:3000   # or a tunnel URL like ngrok for inbound webhooks
```

If `QSTASH_*` is unset, the app falls back to inline `after()` execution — fine for most local development but does not exercise the staged-pipeline retry/DLQ path. **All four variables must be set in production**.

## Important notes

- **Never** commit `.env.local` to git.
- **Never** share credentials in Slack or email.
- The first user you provision becomes `main_admin` automatically.

## Common Commands

```bash
# Development
pnpm dev              # dev server (HMR)
pnpm build            # production build
pnpm start            # run production build
pnpm lint             # eslint
pnpm type-check       # tsc --noEmit

# Probe the cron endpoint
curl -i -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/mark-missed
```

## Verifying the pipeline

1. Log in as a member (provision one through the dashboard team page first).
2. Open a task and upload a small PDF.
3. Server logs should show `[v0] [qstash] publishing stage parse ...` (or `inline run` if QStash creds are unset locally).
4. The submission should walk `queued → parsing → validating → passed|needs_review|failed` within a few seconds.

If a submission gets stuck in production, check:
- The **QStash dashboard** for failed deliveries (look at the DLQ).
- **Vercel logs** for `[pipeline]`, `[validate]`, `[parse]`, `[qstash]` entries.
- The cron job should auto-fail anything stuck for 30+ minutes as a final safety net.

## Troubleshooting

**`Cannot find module '@upstash/qstash'`**
→ Run `pnpm install`.

**`No SUPABASE_SERVICE_ROLE_KEY in env`**
→ Check `.env.local` matches the keys in `.env.local.example`.

**Submission stuck in `validating`**
→ In production, check QStash for failed deliveries. In dev, check the dev-server logs for an unhandled error in the pipeline. The cron rescue will mark it `failed` after 30 minutes.

**`MODEL_NOT_FOUND` or 404 from Gemini**
→ Your `GEMINI_VALIDATION_MODEL` / `GEMINI_VISION_MODEL` overrides may be invalid. Remove them to fall back to the safe defaults (`gemini-flash-lite-latest` / `gemini-flash-latest`).

**`Webhook signature verification failed`**
→ The `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY` env vars don't match your QStash project. Re-copy them from the Upstash QStash dashboard.

## Questions?

- Architecture: [docs/PROJECT_STATUS.md](./docs/PROJECT_STATUS.md)
- Pipeline internals: [docs/PIPELINE_ARCHITECTURE.md](./docs/PIPELINE_ARCHITECTURE.md)
- Production deployment: [DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md)
