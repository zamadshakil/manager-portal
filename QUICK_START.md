# Quick Start Guide — Manager Portal

Get the portal running locally in **5 minutes**.

## Prerequisites
- Node.js 18+
- Git
- Credentials: Supabase, Upstash, Groq API key (from `.env` file provided)

## Setup

```bash
# 1. Clone repo
git clone https://github.com/JobFlowAI/manager-portal.git
cd manager-portal

# 2. Install dependencies
pnpm install

# 3. Set up environment
cp .env.local.example .env.local
# ⚠️ Edit .env.local and add your actual credentials from the provided .env file

# 4. Start dev server
pnpm dev

# 5. Open browser
open http://localhost:3000
```

## Key URLs

- **App:** http://localhost:3000
- **Docs:** See `docs/` folder
- **Database:** Supabase console (link in docs/PROJECT_STATUS.md)
- **Redis:** Upstash console

## Environment Variables (from provided .env file)

Copy these from your `.env` file to `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
GROQ_API_KEY=...
BLOB_READ_WRITE_TOKEN=...
CRON_SECRET=...
```

## Important Notes

- ⚠️ **NEVER** commit `.env.local` to git
- ⚠️ **NEVER** share credentials in Slack or email
- ✓ Use the provided `.env` file from the team
- ✓ Always refer to `.env.local.example` for what's needed

## First Time?

1. Read `README.md` for full project overview
2. See `docs/PROJECT_STATUS.md` for architecture details
3. Check `docs/CODEBASE_AUDIT.md` for code quality assessment

## Common Commands

```bash
# Development
pnpm dev              # Start dev server
pnpm build            # Production build
pnpm start            # Run production build
pnpm lint             # Check code style

# Testing
curl -i -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/mark-missed
```

## Troubleshooting

**"Cannot find module '@supabase/ssr'"**
→ Run `pnpm install`

**"No SUPABASE_SERVICE_ROLE_KEY in env"**
→ Check `.env.local` has the value from your provided `.env` file

**"Redis connection refused"**
→ Check `UPSTASH_REDIS_REST_URL` and token are correct in `.env.local`

## Questions?

- See `docs/PROJECT_STATUS.md` for architecture Q&A
- See `README.md` for feature questions
- Check GitHub issues for known issues
