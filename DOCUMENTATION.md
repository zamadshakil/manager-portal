# Hierarchia Manager Portal — Documentation Index

Complete guide to all project documentation and resources.

---

## 🚀 Quick Navigation

### For New Developers
Start here if you're setting up the project for the first time:

1. **[QUICK_START.md](./QUICK_START.md)** (5 min)
   - Prerequisites
   - 4-step local setup
   - Common commands
   - Troubleshooting

2. **[README.md](./README.md)** (10 min)
   - Project overview
   - Tech stack
   - Project structure
   - Getting started guide

3. **[docs/PROJECT_STATUS.md](./docs/PROJECT_STATUS.md)** (15 min)
   - Complete architecture
   - Data model
   - Security design
   - Module dependencies

### For Pipeline / AI Validation work
If you're touching the validation pipeline (the most common production hot spot):

1. **[docs/PIPELINE_ARCHITECTURE.md](./docs/PIPELINE_ARCHITECTURE.md)** ⭐ CANONICAL
   - Why the pipeline is staged
   - Stage-by-stage description (parse / validate_batch / finalize)
   - Failure handling, retry, DLQ, cron rescue
   - Configuration knobs and tuning advice

### For Historical Context (Audit / April 2026)
These were authored before the Gemini + QStash migration. Non-pipeline
findings (security, RLS, RSC patterns) still apply.

1. **[FIXES_COMPLETED.md](./FIXES_COMPLETED.md)** — April 2026 audit fixes
2. **[docs/IMPLEMENTATION_CHANGES.md](./docs/IMPLEMENTATION_CHANGES.md)** — April 2026 changelog
3. **[docs/CODEBASE_AUDIT.md](./docs/CODEBASE_AUDIT.md)** — April 2026 quality audit

### For Deployment & Operations
If you're deploying or managing the production system:

1. **[README.md#Deployment](./README.md#deployment)** — Vercel setup
2. **[.env.local.example](./.env.local.example)** — Environment variables
3. **[docs/PROJECT_STATUS.md#8-Environment-variables](./docs/PROJECT_STATUS.md#8-environment-variables)** — Detailed env config

---

## 📚 Complete Documentation Map

### Root-Level Guides
- **[README.md](./README.md)** (199 lines)
  - Project overview, features, tech stack
  - Getting started, project structure
  - Development & deployment guides
  - Contributing guidelines

- **[QUICK_START.md](./QUICK_START.md)** (96 lines)
  - 5-minute setup guide
  - Prerequisites checklist
  - Environment configuration
  - Common commands
  - Troubleshooting

- **[FIXES_COMPLETED.md](./FIXES_COMPLETED.md)** (264 lines)
  - Executive summary of audit fixes
  - Implementation details for each fix
  - Testing & verification checklist
  - Quality assurance metrics
  - Ready for production status

- **[DOCUMENTATION.md](./DOCUMENTATION.md)** (this file)
  - Documentation index and navigation

### Core Documentation (docs/ folder)

#### Architecture & Design
- **[docs/PROJECT_STATUS.md](./docs/PROJECT_STATUS.md)** (447 lines) ⭐ MAIN SPEC
  - TL;DR for new developers
  - Product overview & roles
  - High-level architecture diagram
  - Complete data model
  - Security & RLS design
  - Module dependency matrix
  - Environment variables guide
  - Known issues & roadmap

#### Implementation & Changes
- **[docs/IMPLEMENTATION_CHANGES.md](./docs/IMPLEMENTATION_CHANGES.md)** (188 lines)
  - Summary of audit fixes
  - Cron schedule solution details
  - Tailwind configuration
  - Environment & docs improvements
  - Files changed with types
  - Verification checklist
  - Next steps

#### Audit & Code Quality
- **[docs/CODEBASE_AUDIT.md](./docs/CODEBASE_AUDIT.md)** (555 lines)
  - Executive summary
  - PROJECT_STATUS.md accuracy review
  - Code quality assessment
  - Security analysis
  - Architecture evaluation
  - Performance considerations
  - Best practices compliance
  - Detailed issue inventory
  - Recommendations by severity
  - Metrics and scoring

- **[docs/AUDIT_SUMMARY.md](./docs/AUDIT_SUMMARY.md)** (330 lines)
  - Executive summary
  - Quality scorecard (92/100)
  - Key patterns & rules
  - Issue tracking
  - Priority action items
  - Code quality breakdown

### Environment & Configuration
- **[.env.local.example](./.env.local.example)** (52 lines)
  - Complete environment template
  - All required variables documented
  - Links to credential sources
  - Setup instructions
  - Security guidance

- **[vercel.json](./vercel.json)**
  - Vercel deployment configuration
  - Cron job schedule (with explanation)

- **[tailwind.config.ts](./tailwind.config.ts)** (68 lines)
  - Design token configuration
  - Tailwind theme extension
  - Color, radius, shadow mappings

---

## 🎯 Documentation by Topic

### Getting Started
- [QUICK_START.md](./QUICK_START.md) — 5-minute setup
- [README.md#Getting-Started](./README.md#getting-started) — Prerequisites & setup
- [.env.local.example](./.env.local.example) — Environment template

### Architecture & Design
- [docs/PROJECT_STATUS.md](./docs/PROJECT_STATUS.md) — Complete specification
- [README.md#Project-Structure](./README.md#project-structure) — File organization
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — (see PROJECT_STATUS.md)

### Security
- [docs/PROJECT_STATUS.md#3-Roles-RLS](./docs/PROJECT_STATUS.md#3-roles-rls-and-the-principle-of-defence-in-depth) — 3-layer defense
- [docs/CODEBASE_AUDIT.md#Security](./docs/CODEBASE_AUDIT.md#security-analysis) — Security assessment
- [README.md#Security](./README.md#key-features) — Security features

### Deployment & Operations
- [README.md#Deployment](./README.md#deployment) — Vercel deployment
- [docs/PROJECT_STATUS.md#8-Environment-variables](./docs/PROJECT_STATUS.md#8-environment-variables) — Environment config
- [FIXES_COMPLETED.md#Cron-Schedule](./FIXES_COMPLETED.md#1-cron-schedule-upstash-redis-solution-) — Cron monitoring

### Cron Jobs & Scheduling
- [FIXES_COMPLETED.md#1-Cron-Schedule](./FIXES_COMPLETED.md#1-cron-schedule-upstash-redis-solution-) — Solution details
- [docs/IMPLEMENTATION_CHANGES.md#1-Cron-Schedule](./docs/IMPLEMENTATION_CHANGES.md#1-cron-schedule-upstash-redis-15-minute-solution) — Implementation
- [docs/PROJECT_STATUS.md#6.5-Cron](./docs/PROJECT_STATUS.md#65-cron--missed-deadlines-and-stuck-pipeline-recovery) — Technical spec

### Design System & Styling
- [FIXES_COMPLETED.md#2-Tailwind](./FIXES_COMPLETED.md#2-tailwind-configuration-design-tokens-) — Tailwind setup
- [tailwind.config.ts](./tailwind.config.ts) — Configuration file
- [app/globals.css](./app/globals.css) — Design tokens

### Data Model
- [docs/PROJECT_STATUS.md#4-Data-model](./docs/PROJECT_STATUS.md#4-data-model) — Complete schema
- [scripts/001_init_schema.sql](./scripts/001_init_schema.sql) — SQL definitions

### Code Quality & Best Practices
- [docs/CODEBASE_AUDIT.md](./docs/CODEBASE_AUDIT.md) — Full audit report
- [docs/AUDIT_SUMMARY.md](./docs/AUDIT_SUMMARY.md) — Summary & scorecard
- [docs/PROJECT_STATUS.md#7-Module-dependency-matrix](./docs/PROJECT_STATUS.md#7-module-dependency-matrix) — Architecture patterns

### Troubleshooting
- [QUICK_START.md#Troubleshooting](./QUICK_START.md#troubleshooting) — Common issues
- [README.md](./README.md) — Feature & setup questions
- [docs/CODEBASE_AUDIT.md#Known-Issues](./docs/CODEBASE_AUDIT.md#known-issues) — Technical issues

---

## 📋 File Quick Reference

| File | Type | Size | Purpose |
|------|------|------|---------|
| README.md | Guide | 199 lines | Project overview & onboarding |
| QUICK_START.md | Guide | 96 lines | 5-minute setup guide |
| FIXES_COMPLETED.md | Report | 264 lines | Audit fixes summary |
| DOCUMENTATION.md | Index | (this) | Documentation map |
| docs/PROJECT_STATUS.md | Spec | 447 lines | Complete architecture |
| docs/IMPLEMENTATION_CHANGES.md | Changelog | 188 lines | Detailed fix changes |
| docs/CODEBASE_AUDIT.md | Report | 555 lines | Code quality audit |
| docs/AUDIT_SUMMARY.md | Summary | 330 lines | Audit scorecard |
| .env.local.example | Template | 52 lines | Environment setup |
| tailwind.config.ts | Config | 68 lines | Design tokens |
| vercel.json | Config | 10 lines | Deployment config |

---

## 🔄 Documentation Maintenance

### When to Update Documentation

**Update immediately:**
- Major architectural changes
- New features or modules
- Security-relevant changes
- Environment variable additions
- Breaking API changes

**Update regularly:**
- [docs/PROJECT_STATUS.md](./docs/PROJECT_STATUS.md) — After major features
- [docs/KNOWN_ISSUES.md](./docs/KNOWN_ISSUES.md) — As issues are discovered
- [README.md](./README.md) — Tech stack version updates

**Update yearly:**
- [docs/CODEBASE_AUDIT.md](./docs/CODEBASE_AUDIT.md) — Annual quality audit
- [docs/ARCHITECTURE.md](./docs/PROJECT_STATUS.md) — Annual design review

### Documentation Standards

All documentation should include:
- Clear section headings (h2-h4)
- Links to related docs
- Code examples where relevant
- Table of contents for long documents
- "Last updated" dates on specifications

---

## 🎓 Learning Path

### Day 1 (Setup)
1. [QUICK_START.md](./QUICK_START.md) — Get it running (5 min)
2. [README.md](./README.md) — Understand the project (10 min)
3. Explore the app in browser

### Day 2-3 (Architecture)
1. [docs/PROJECT_STATUS.md](./docs/PROJECT_STATUS.md) — Full specification (30 min)
2. Read through key source files:
   - `app/layout.tsx` — Root layout
   - `app/actions/` — Server actions
   - `lib/supabase/` — Database clients
3. Trace one end-to-end flow (create → assign → submit → validate)

### Week 1-2 (Deep Dive)
1. [docs/CODEBASE_AUDIT.md](./docs/CODEBASE_AUDIT.md) — Code quality (30 min)
2. Study the cron job implementation:
   - [lib/upstash-scheduler.ts](./lib/upstash-scheduler.ts)
   - [app/api/cron/mark-missed/route.ts](./app/api/cron/mark-missed/route.ts)
3. Review database schema: [scripts/001_init_schema.sql](./scripts/001_init_schema.sql)
4. Understand RLS: [scripts/002_helper_functions.sql](./scripts/002_helper_functions.sql)

### First Feature
1. Check [docs/PROJECT_STATUS.md#10-Known-issues](./docs/PROJECT_STATUS.md#10-known-issues) for guidance
2. Review related modules in the code
3. Follow the pattern established in existing code
4. Test thoroughly
5. Update relevant documentation

---

## 📞 Getting Help

1. **Setup issues** → [QUICK_START.md#Troubleshooting](./QUICK_START.md#troubleshooting)
2. **Architecture questions** → [docs/PROJECT_STATUS.md](./docs/PROJECT_STATUS.md)
3. **Code quality** → [docs/CODEBASE_AUDIT.md](./docs/CODEBASE_AUDIT.md)
4. **Specific feature** → Check [README.md](./README.md) or [docs/PROJECT_STATUS.md](./docs/PROJECT_STATUS.md)
5. **Deployment** → [README.md#Deployment](./README.md#deployment)

---

## Major Milestones

**May 1, 2026 — Validation pipeline migration**
- Replaced Groq with Google Gemini (`@ai-sdk/google`).
- Removed Tesseract.js — image OCR is now vision-only via Gemini.
- Re-platformed the pipeline onto Upstash QStash with staged messages
  (`parse → validate_batch_N → finalize`).
- Added per-LLM-call timeouts and a function-level abort budget.
- See [docs/PIPELINE_ARCHITECTURE.md](./docs/PIPELINE_ARCHITECTURE.md).

**April 30, 2026 — Initial audit fixes**
- Cron schedule via Upstash Redis interval gating.
- Tailwind config wired to design tokens.
- Environment and README overhaul.
- See [FIXES_COMPLETED.md](./FIXES_COMPLETED.md).

---

**Last Updated:** May 1, 2026  
**Status:** Documentation current with the staged QStash + Gemini pipeline.
