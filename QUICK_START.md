# Quick Start Guide — Manager Portal

Get the portal running locally in **5 minutes**.

## Prerequisites
- Node.js 22+ (required by `engines` in package.json)
- Git
- Credentials from your team: Supabase (Railway Kong URL + JWTs), OpenRouter API key, R2, Upstash, Inngest

## Setup

```bash
# 1. Clone repo
git clone https://github.com/JobFlowAI/manager-portal.git
cd manager-portal

# 2. Install dependencies
pnpm install

# 3. Set up environment
cp .env.local.example .env.local
# ⚠️ Edit .env.local — see the file for detailed instructions on each variable

# 4. Start dev server
pnpm dev

# 5. Start Inngest dev server (separate terminal — required for background jobs)
npx inngest-cli@latest dev

# 6. Open browser
open http://localhost:3000
```

## Key URLs

- **App:** http://localhost:3000
- **Inngest Dashboard:** http://localhost:8288 (started by inngest-cli)
- **Docs:** See `docs/` folder
- **Database:** Supabase Studio on Railway (link in env vars)
- **Redis:** Upstash console

## Critical Environment Variables

Copy these from your team's credentials to `.env.local`:

```env
# Supabase (self-hosted on Railway, fronted by Kong)
NEXT_PUBLIC_SUPABASE_URL=https://kong-production-<id>.up.railway.app
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# LLM (OpenRouter — powers both validation pipeline and Smart AI chat)
OPENROUTER_API_KEY=sk-or-v1-...

# File Storage (Cloudflare R2)
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=...
R2_PUBLIC_URL=https://pub-<id>.r2.dev

# Caching & Rate Limiting
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...

# Background Jobs (auto-set to "local" in dev by lib/inngest/client.ts)
INNGEST_EVENT_KEY=local
INNGEST_SIGNING_KEY=local

# Smart AI services (optional in local dev — chat falls back to native path)
MCP_SERVICE_URL=...
MCP_SERVICE_TOKEN=...
RAG_SERVICE_URL=...
RAG_SERVICE_TOKEN=...

# Email (optional — skipped if missing)
BREVO_API_KEY=...

# Security
CRON_SECRET=...
```

See `.env.local.example` for the **full list** with documentation for each variable.

## Important Notes

- ⚠️ **NEVER** commit `.env.local` to git
- ⚠️ **NEVER** share credentials in Slack or email
- ✓ Use the provided credentials from the team
- ✓ Always refer to `.env.local.example` for what's needed
- ✓ Inngest dev server auto-detects functions — no registration needed locally

## First Time?

1. Read `README.md` for full project overview
2. See `docs/PROJECT_STATUS.md` for architecture details
3. Check `docs/SMART_AI_AUDIT.md` for the Smart AI subsystem audit
4. See `docs/CODEBASE_AUDIT.md` for code quality assessment

## Common Commands

```bash
# Development
pnpm dev                    # Start Next.js dev server
pnpm build                  # Production build
pnpm start                  # Run production build
pnpm lint                   # Check code style
npx inngest-cli@latest dev  # Start Inngest dev server

# Database
# Apply migrations via Supabase Studio → SQL Editor on Railway

# Testing cron endpoint locally
curl -i http://localhost:3000/api/cron/mark-missed
# (CRON_SECRET is skipped when unset — safe for local dev)
```

## Troubleshooting

**"Cannot find module '@supabase/ssr'"**
→ Run `pnpm install`

**"No SUPABASE_SERVICE_ROLE_KEY in env"**
→ Check `.env.local` has the Railway Supabase service-role JWT

**"Redis connection refused"**
→ Check `UPSTASH_REDIS_REST_URL` and token are correct in `.env.local`

**Background jobs not running (submissions stuck in "queued")**
→ Make sure `npx inngest-cli@latest dev` is running in a separate terminal

**Smart AI chat returns 503**
→ Check `OPENROUTER_API_KEY` is set. The chat falls back to native path if MCP/RAG services are not configured.

**Railway deployment fails**
→ Ensure `output: "standalone"` is in `next.config.mjs` and `railway.json` is present

## Questions?

- See `docs/PROJECT_STATUS.md` for architecture Q&A
- See `docs/SMART_AI_AUDIT.md` for Smart AI details
- See `README.md` for feature questions
- Check GitHub issues for known issues

---

**Last Updated:** May 5, 2026
