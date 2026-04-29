# Hierarchia Manager Portal

A comprehensive task and assignment management platform built with Next.js, Supabase, and Upstash. Designed for efficient team collaboration, deadline tracking, and AI-powered document processing.

## Overview

The Hierarchia Manager Portal enables organizations to:

- **Create & Manage Tasks** — Organize hierarchical task structures with deadlines and submission rules
- **Assign to Teams** — Distribute tasks to members with role-based permissions
- **Process Submissions** — Validate submissions with AI-powered document parsing and analysis
- **Track Progress** — Monitor assignment status with real-time updates and deadline alerts
- **Automated Workflows** — Run scheduled cron jobs every 15 minutes to update task statuses

## Tech Stack

- **Frontend**: Next.js 16, React 19, Tailwind CSS 4
- **Database**: Supabase PostgreSQL with RLS (Row-Level Security)
- **Caching & Tasks**: Upstash Redis (15-minute scheduled jobs)
- **AI**: Groq API for document parsing and OCR
- **File Storage**: Vercel Blob for document uploads
- **Deployment**: Vercel with automated CI/CD

## Getting Started

### Prerequisites

- Node.js 18+ 
- Git
- A Supabase account (https://supabase.com)
- An Upstash Redis account (https://upstash.com)
- A Groq API key (https://console.groq.com)

### Local Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/JobFlowAI/manager-portal.git
   cd manager-portal
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   # or: npm install / yarn install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.local.example .env.local
   ```
   
   Then edit `.env.local` and add your actual credentials:
   - Supabase URL and API keys
   - Upstash Redis credentials
   - Groq API key
   - CRON_SECRET for job authentication

4. **Start the development server**
   ```bash
   pnpm dev
   ```
   
   Open [http://localhost:3000](http://localhost:3000) to see the application.

## Project Structure

```
app/
├── api/
│   ├── cron/              # Scheduled tasks (15-minute intervals via Upstash)
│   │   ├── mark-missed/   # Mark overdue assignments as missed
│   │   └── scheduled-init/ # Initialize Upstash scheduler
│   └── download/          # File download endpoints
├── actions/               # Server actions for form submission
├── (dashboard)/           # Protected routes for authenticated users
├── globals.css            # Tailwind CSS with design tokens
└── layout.tsx             # Root layout

components/
├── ui/                    # Shadcn/ui components
├── forms/                 # Form components for tasks, assignments
├── dashboard/             # Dashboard-specific components
└── ...

lib/
├── supabase/              # Supabase client (admin, browser)
├── utils.ts               # Utility functions
├── upstash-scheduler.ts   # 15-minute task scheduling logic
└── data.ts                # Database query helpers

docs/
├── PROJECT_STATUS.md      # Detailed project status and features
├── ARCHITECTURE.md        # System design documentation
└── ...
```

## Key Features

### Task Management
- Hierarchical task organization
- Due date tracking with automatic missed status
- Late submission rules (allow_late flag)
- Task metadata and versioning

### Assignment Workflow
1. Task created with deadlines
2. Assigned to team members
3. Members submit solutions
4. AI validates documents (OCR, PDF parsing)
5. Results recorded in database
6. Automatic deadline enforcement

### Scheduled Jobs (Every 15 Minutes)
Since Vercel Cron allows only one daily job, we use **Upstash Redis** to maintain 15-minute intervals:

- **Mark Missed**: Updates assignments past due_at to "missed" status if late submissions are disallowed
- **Auto-fail Stuck**: Recovers submissions stuck in parsing/validating for 30+ minutes

### Security
- Row-Level Security (RLS) on all tables
- Server actions validate user permissions
- CRON_SECRET protects scheduled endpoints
- Sensitive credentials stored in environment variables only

## Development Workflow

### Running Tests
```bash
pnpm lint
# Tests: See docs/TESTING.md for test suite setup
```

### Building for Production
```bash
pnpm build
pnpm start
```

### Database Schema
See `docs/PROJECT_STATUS.md` for complete table definitions.

Key tables:
- `tasks` — Task definitions with metadata
- `task_assignments` — Assignment instances
- `submissions` — Member submissions with parsing results
- `users` — Team members with roles

### Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public Supabase key | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin operations | Yes |
| `UPSTASH_REDIS_REST_URL` | Redis endpoint | Yes |
| `UPSTASH_REDIS_REST_TOKEN` | Redis auth | Yes |
| `GROQ_API_KEY` | AI document parsing | Yes |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob uploads | No |
| `CRON_SECRET` | Cron job auth | Yes |

## Deployment

### Deploy to Vercel

1. **Connect repository** to Vercel at https://vercel.com/new
2. **Set environment variables** in Vercel project settings
3. **Deploy** — Vercel automatically builds and deploys on push to main

The Vercel deployment includes:
- Automatic daily cron trigger (rate-limited to 15-min via Upstash)
- Serverless functions for all routes
- Edge caching and optimizations

## Documentation

- **[PROJECT_STATUS.md](docs/PROJECT_STATUS.md)** — Complete status, features, and implementation details
- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** — System design and data flow
- **[CODEBASE_AUDIT.md](docs/CODEBASE_AUDIT.md)** — Code quality assessment

## Contributing

1. Create a feature branch from `main`
2. Make changes and test locally
3. Commit with clear messages
4. Open a pull request for review

## Team

Built by **JobFlowAI** for efficient task and assignment management.

## License

Proprietary — All rights reserved.

## Support

For issues, questions, or feature requests, please open a GitHub issue or contact the team.
