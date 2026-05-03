# mcp-service

Node.js Model Context Protocol gateway for the Hierarchia portal. Sits
between the Next.js portal and the FastAPI `rag-service`, runs the
LangChain/LangGraph orchestration, and streams chat completions back to
the browser using the AI SDK UI Message Stream protocol so the portal's
`useChat` hook consumes the output directly.

```
Next.js portal  ──HTTPS──>  mcp-service (this)  ──HTTP──>  rag-service (pgvector)
                                  │
                                  └─────────────────────>  AI Gateway (LLM)
```

## Endpoints

| Method | Path        | Purpose                                                      |
| ------ | ----------- | ------------------------------------------------------------ |
| GET    | `/health`   | Liveness probe + config snapshot                             |
| POST   | `/v1/chat`  | Streamed chat turn (UI Message Stream protocol body)         |

## Auth

`Authorization: Bearer <MCP_SERVICE_TOKEN>` is required on every call.
The Next.js portal route at `app/api/smart-ai/chat/route.ts` is the only
intended client.

## Environment

| Variable             | Required | Description                                       |
| -------------------- | -------- | ------------------------------------------------- |
| `MCP_SERVICE_TOKEN`  | yes      | Shared secret with the Next.js portal             |
| `RAG_SERVICE_URL`    | yes      | URL of the FastAPI rag-service                    |
| `RAG_SERVICE_TOKEN`  | yes      | Bearer token expected by the RAG service          |
| `AI_GATEWAY_API_KEY` | optional | Only required when not using a zero-config provider |
| `SMART_AI_MODEL`     | no       | Default `openai/gpt-5-mini`                       |
| `SMART_AI_TOP_K`     | no       | Default `6` chunks                                |
| `PORT`               | no       | Set automatically by Railway                      |

## Local development

```bash
cd mcp-service
npm install
npm run dev
```

Then in the portal `.env.local`:

```
MCP_SERVICE_URL=http://localhost:3030
MCP_SERVICE_TOKEN=dev-token
```

## Railway deployment

Railway will pick up `Dockerfile` automatically. After the first deploy:

1. Set the variables above under **Variables**.
2. Add the public URL Railway assigns to the Next.js project's
   `MCP_SERVICE_URL`.
3. Verify `/health` returns `{ "ok": true, "rag_configured": true }`.
