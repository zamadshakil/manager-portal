# rag-service

FastAPI + LangChain + LangGraph + pgvector retrieval service for the
Hierarchia portal. Lives alongside the Next.js app (`/`) and the Node.js
MCP gateway (`/mcp-service`) in this monorepo, deployed independently to
Railway.

## What it does

- **Indexing** (`POST /v1/index`): embeds rows from Supabase
  (submissions, announcements, materials, tasks, validation runs) and
  uploaded files into a single `rag_documents` table backed by pgvector.
- **Retrieval** (`POST /v1/retrieve`): role-scoped similarity search.
  Members see only their own documents, managers their team's, main
  admins everything.
- **Analytics** (`GET /v1/analytics`): metrics consumed by the Smart AI
  page in the portal.
- **Audit log** (`POST /v1/log/query`): every chat turn is logged with
  scope, retrieved sources count, latency, and token usage.

The service does **not** call LLMs for completions — that orchestration
is owned by `mcp-service` (LangGraph workflow). This service only does:

1. Embedding generation (`text-embedding-3-small` by default)
2. pgvector cosine-similarity search
3. Postgres analytics queries

## Environment

| Variable             | Required | Description                                            |
| -------------------- | -------- | ------------------------------------------------------ |
| `DATABASE_URL`       | yes      | Postgres URL with the `vector` extension installed     |
| `RAG_SERVICE_TOKEN`  | yes      | Shared bearer token (matches MCP and Next.js portals)  |
| `OPENAI_API_KEY`     | yes      | Embedding generation                                   |
| `EMBEDDING_MODEL`    | no       | Default `text-embedding-3-small`                       |
| `EMBEDDING_DIM`      | no       | Default `1536`                                         |
| `PORT`               | no       | Set automatically by Railway                           |

## Local development

```bash
cd rag-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

export DATABASE_URL=postgres://...
export RAG_SERVICE_TOKEN=dev-token
export OPENAI_API_KEY=sk-...

uvicorn main:app --reload --port 8000
```

Then point the Next.js portal at it via:

```
RAG_SERVICE_URL=http://localhost:8000
RAG_SERVICE_TOKEN=dev-token
```

## Railway deployment

Railway will pick up `Dockerfile` automatically. Ensure the project has:

1. A PostgreSQL plugin with `vector` extension enabled
   (`CREATE EXTENSION IF NOT EXISTS vector`).
2. The variables above set under **Variables**.
3. `MCP_SERVICE_URL` on the Next.js project pointing at the MCP service.
