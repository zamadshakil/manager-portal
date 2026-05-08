# Hierarchia Manager Portal — Client Delivery Package

> **Version 2.0** | May 8, 2026 | Prepared by JobFlowAI Engineering

---

## 📦 Documentation Package

This delivery package contains seven comprehensive documents covering every aspect of the Hierarchia Manager Portal — from executive overview to deployment instructions and AI model strategy.

| # | Document | Pages | What You'll Learn |
|---|----------|-------|-------------------|
| **01** | [Executive Overview](./01_EXECUTIVE_OVERVIEW.md) | 5 | Product vision, features, tech stack, user roles |
| **02** | [Technical Architecture](./02_TECHNICAL_ARCHITECTURE.md) | 8 | System design, database schema, security model, AI pipeline |
| **03** | [Glossary of Terms](./03_GLOSSARY.md) | 4 | Every term and technology explained A-Z |
| **04** | [Data Flows & User Journeys](./04_DATA_FLOWS.md) | 6 | Step-by-step flows for all operations, permission matrix |
| **05** | [Deployment Guide](./05_DEPLOYMENT_GUIDE.md) | 5 | Environment setup, Railway deployment, security checklist |
| **06** | [Presentation Guide](./06_PRESENTATION_GUIDE.md) | 6 | Demo script, talking points, FAQ, value propositions |
| **07** | [AI Model Strategy](./07_AI_MODEL_STRATEGY.md) | 7 | Compatible models, cost/quality/speed comparison, recommended configs |

---

## 🚀 Quick Start for Presenters

1. **Read** [01 — Executive Overview](./01_EXECUTIVE_OVERVIEW.md) for the product pitch
2. **Follow** [06 — Presentation Guide](./06_PRESENTATION_GUIDE.md) for the 15-minute demo script
3. **Reference** [03 — Glossary](./03_GLOSSARY.md) for any technical term definitions
4. **Use** [04 — Data Flows](./04_DATA_FLOWS.md) to explain "how it works under the hood"
5. **Show** [07 — AI Model Strategy](./07_AI_MODEL_STRATEGY.md) for the cost/quality/speed model comparison

## 🔧 Quick Start for Engineers

1. **Read** [02 — Technical Architecture](./02_TECHNICAL_ARCHITECTURE.md) for system design
2. **Follow** [05 — Deployment Guide](./05_DEPLOYMENT_GUIDE.md) to set up the environment
3. **Reference** [03 — Glossary](./03_GLOSSARY.md) for terminology
4. **Review** existing docs in `docs/PROJECT_STATUS.md` for full database specification

---

## 📊 At a Glance

- **15+ database tables** with Row-Level Security on every table
- **Two-stage migrations** — foundational `scripts/001–007` + timestamped `supabase/migrations/20260501–-20260512`
- **11 server action modules** covering all CRUD operations
- **API routes** for Smart AI (chat/upload/threads/analytics/health), Messaging (conversations/messages/typing/presence/upload), AI credits, downloads, pipeline, cron, vitals
- **12 dashboard pages** with role-adaptive content (incl. Smart AI, Messaging, AI Usage)
- **3-layer authorisation** (Middleware → Server Action → Postgres RLS)
- **OpenRouter → Gemini 2.0 Flash** for validation + summary + vision OCR
- **OpenRouter → GPT-4o-mini** (configurable) + native pgvector RAG for the Smart AI chat
- **50+ UI components** via shadcn/ui + Radix

---

*© 2026 JobFlowAI — All Rights Reserved*
