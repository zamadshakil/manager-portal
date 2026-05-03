# Smart AI Codebase Audit

**Branch audited:** `smart-ai-audit` (against `main` of `JobFlowAI/manager-portal`)
**Date:** 2026-05-04
**Scope:** Smart AI chat surface (`app/(dashboard)/dashboard/smart-ai`), the Multi-Channel/Coordinator Process (`mcp-service/`), the Retrieval-Augmented Generation service (`rag-service/`), the indexing pipeline (`lib/smart-ai/indexer.ts`, server actions), the chat API route (`app/api/smart-ai/*`), and supporting Supabase schema.

This document supersedes the previous `docs/CODEBASE_AUDIT.md`. **Findings only — no code changes have been applied yet.** A phased remediation plan is included at the end.

The agreed RLS scoping model for the new chat tables is **per-user only** (each user owns their threads, messages, and chat attachments).

---

## 1. System Overview

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         Smart AI Page (Next.js App)                        │
│                                                                            │
│  ChatPanel ──useChat()──▶ /api/smart-ai/chat ──▶ MCP service (Railway)    │
│       │                                              │                     │
│       │ upload                                       ├─ tools:             │
│       ▼                                              │   queryDatabase     │
│  /api/smart-ai/upload ─▶ R2 + parse + index ──▶     │   searchDocument    │
│                                                      │   insertRecord      │
│                                                      │   updateRecord      │
│                                                      │   listSchema        │
│                                                      │                     │
│                                                      ▼                     │
│                                              streamText (AI SDK 6)         │
│                                                      │                     │
│                                              writes chat_messages          │
└────────────────────────────────────────────────────────────────────────────┘

         RAG Service (FastAPI on Railway)
         ─────────────────────────────────
         POST /index    → upsert chunk embeddings into pgvector
         POST /retrieve → top-k similarity search, role-scoped
         GET  /health
```

The intent is sound: a thin Next.js shell brokers between an authenticated user and a long-lived MCP service that owns tool execution + thread persistence, while the RAG service is the single source of truth for embedded content (PDFs, materials, submissions, tasks, chat attachments). The implementation has multiple breaking gaps that prevent that architecture from working end-to-end.

---

## 2. Findings

Severity legend:
- **CRITICAL** — runtime error or feature unavailable in production today.
- **HIGH** — silent functional gap; system appears to work but does not deliver promised behavior.
- **MEDIUM** — robustness / security / cost issue.
- **LOW** — polish.

---

### CRITICAL

#### C1. Required Supabase tables do not exist

**Files:** `mcp-service/persistence.ts`, `app/api/smart-ai/upload/route.ts`
**Tables referenced but never created:** `chat_threads`, `chat_messages`, `chat_attachments`

`mcp-service/persistence.ts` reads and writes `chat_threads` and `chat_messages`. `app/api/smart-ai/upload/route.ts` inserts into `chat_attachments`. Searching every `.sql` file in `scripts/` and `supabase/migrations/` returns zero `CREATE TABLE` statements for any of them.

**Effect at runtime:**
- Every uploaded chat attachment fails the `attachments` insert and returns 500.
- The MCP service's `loadThreadHistory` and `saveMessage` calls fail silently (errors are swallowed and logged), so no chat is ever persisted.

**Recommendation:** Add a migration `supabase/migrations/<ts>_smart_ai_chat.sql` creating the three tables with **per-user RLS**:

```sql
create table public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  role text not null check (role in ('user','assistant','system','tool')),
  content jsonb not null,
  attachments jsonb,
  created_at timestamptz not null default now()
);

create table public.chat_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid references public.chat_threads(id) on delete set null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  storage_url text not null,
  parsed_text text,
  created_at timestamptz not null default now()
);

create index on public.chat_messages(thread_id, created_at);
create index on public.chat_attachments(user_id, created_at desc);

alter table public.chat_threads     enable row level security;
alter table public.chat_messages    enable row level security;
alter table public.chat_attachments enable row level security;

create policy "own threads"     on public.chat_threads
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own messages"    on public.chat_messages
  for all using (exists (select 1 from public.chat_threads t
                         where t.id = thread_id and t.user_id = auth.uid()));
create policy "own attachments" on public.chat_attachments
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

---

#### C2. MCP service uses AI SDK 4 tool API under AI SDK 6

**Files:** `mcp-service/supabase-tools.ts`, `mcp-service/index.ts`
**Installed version:** `ai@6.0.168`

`tool({ parameters: z.object(...) })` and `streamText({ ..., maxSteps: 5 })` are AI SDK 4/5 names. AI SDK 6 renamed them to:

- `parameters` → `inputSchema`
- `maxSteps: N` → `stopWhen: stepCountIs(N)` (and `stepCountIs` is imported from `'ai'`)

Tools defined with the old key are accepted by TypeScript (the wrapper signature is permissive) but produce zero registered tools at the provider boundary.

**Effect:** The agent has **no working tool calls** — `queryDatabase`, `searchDocument`, `insertRecord`, `updateRecord`, `listSchema` are all dead. The model can only produce free-text answers, defeating the entire MCP architecture.

**Recommendation:** Rename `parameters` → `inputSchema` in every tool and replace `maxSteps` with `stopWhen: stepCountIs(5)`.

---

#### C3. Chat attachments never reach the model

**Files:** `components/dashboard/smart-ai/chat-panel.tsx`, `app/api/smart-ai/chat/route.ts`

The chat panel sends:
```ts
sendMessage({ text, annotations: [{ attachments }] })
```
And the chat route reads:
```ts
const attachments = m.annotations?.[0]?.attachments
```

`UIMessage` in AI SDK 6 has shape `{ id, role, metadata, parts }`. There is no `annotations` field — the SDK strips unknown keys before transport. As a result, the chat-attachment list is dropped on the wire and `searchDocument` is never invoked with the right `documentId`.

**Recommendation:** Carry attachments via `UIMessage.metadata` (typed) or as `data-attachments` parts. The MCP route already inspects `body.messages` directly, so a small contract change (e.g. a top-level `attachmentsByMessageId` field on the request body) is the cleanest fix.

---

### HIGH

#### H1. The indexer hard-disables every important source type

**File:** `lib/smart-ai/indexer.ts` (lines ~70-72)

```ts
if (["task", "submission", "validation_run", "announcement", "rule"].includes(input.source_type)) {
  return
}
```

Every server action (`app/actions/tasks.ts`, `app/actions/submissions.ts`, `app/actions/announcements.ts`) calls `indexDocument(...)` after writes, but this early-return drops them all. The Inngest `reindex-submission` step is also a no-op. Net effect: the RAG corpus contains **only** materials and chat attachments. Questions like "summarize the last week of submissions for my team" cannot be grounded.

**Recommendation:** Remove the early return, or replace it with an env-var-driven allow-list (`RAG_INDEXED_TYPES=material,chat_attachment,submission,task,announcement`). Then run `scripts/backfill-rag-index.ts` once.

---

#### H2. MCP persistence uses anon key + user JWT and silently fails on RLS

**File:** `mcp-service/persistence.ts`

```ts
createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { headers: { Authorization: `Bearer ${userToken}` } }
})
```

Two problems:
1. The MCP service runs server-side on Railway and should not depend on user JWT freshness during long-running streams (a JWT expiring mid-conversation will start blocking writes).
2. All inserts are wrapped in `try/catch` that only `console.error`s — operators see no signal that history is being lost.

**Recommendation:** Use `SUPABASE_SERVICE_ROLE_KEY` in the MCP service and do tenant scoping in code (`user_id = profile.id`). Surface insert failures as a structured `data-warning` UI part on the stream so the chat panel can render a "history not saved" toast.

---

#### H3. Thread / message hydration logic doesn't match the client transport

**Files:** `mcp-service/index.ts`, `components/dashboard/smart-ai/chat-panel.tsx`

`mcp-service/index.ts` hydrates DB history only when:
```ts
body.threadId && body.messages.length === 1
```

The client uses `DefaultChatTransport`, which sends the full visible history on every request. After the second turn, `messages.length > 1` and the branch never triggers. Combined with H2 (history may not be persisted at all), the assistant has amnesia within a single tab as soon as the user clicks **Clear** (which only resets in-memory state — see H4).

**Recommendation:** Pick one source of truth. Preferred: client sends `{ threadId, message: lastUserTurn }` and the server hydrates prior messages from DB. Simpler, cheaper, deterministic.

---

#### H4. `threadId` is minted in `localStorage` and never rotated

**File:** `components/dashboard/smart-ai/chat-panel.tsx` (lines ~99-108)

```ts
const stored = localStorage.getItem("smart-ai-thread-id")
if (stored) setThreadId(stored)
else { const id = crypto.randomUUID(); localStorage.setItem(...); setThreadId(id) }
```

Issues:
- **Privacy:** if user A signs out and user B signs in on the same browser, the cached thread ID is reused. RLS will block reads but new messages get inserted under user B with the old thread reference, polluting `chat_threads`.
- **UX:** the **Clear** button resets `messages` in memory but doesn't create a new thread; the next user message is appended to the old thread on the server.

**Recommendation:** Key the localStorage entry by `profile.id`, and add a "New conversation" action that mints a fresh UUID and clears UI state together.

---

#### H5. Two competing schedulers for cron tasks

**Files:** `lib/inngest/functions.ts` (cron `* * * * *`), `lib/upstash-scheduler.ts`

The Inngest cron runs every minute and calls `recordTaskExecution`. The Upstash scheduler is referenced in docs as the gating mechanism. They are not coordinated — `recordTaskExecution` is invoked from both paths, doubling rate-limit cost and risking duplicate side-effects.

**Recommendation:** Pick one. If Inngest is canonical, delete the Upstash gate. If Upstash is canonical, change the Inngest function to a Vercel-cron-triggered route handler that defers to the Upstash gate.

---

#### H6. `r2.head()` returns nothing

**File:** `lib/r2.ts`

```ts
export async function head(url: string) {
  await r2.send(new HeadObjectCommand({...}))
}
```

The function awaits but doesn't return the response. No current caller reads the result, but the API is misleading; either `return` the response or remove the function.

---

### MEDIUM

#### M1. Every MCP error is swallowed by `.catch(() => null)`

**File:** `lib/smart-ai/client.ts`

The chat API silently downgrades to fallback whenever the MCP fetch errors. Operators have no visibility into MCP outages, token rotations, or schema drift. Add structured logging (`console.error("[smart-ai] mcp upstream error", { status, body })`) and surface a `data-warning` part to the UI so users see "Running in fallback mode" instead of believing the system is healthy.

---

#### M2. Tool definitions allow writes to arbitrary tables

**File:** `mcp-service/supabase-tools.ts`

`queryDatabase`, `insertRecord`, and `updateRecord` accept any `table` string. RLS protects reads, but write tools can target any table the user has insert/update privileges on (`activity_log`, etc.). The LLM is one prompt away from corrupting state.

**Recommendation:**
- Maintain an allow-list per role: e.g. members get `read:tasks,submissions,announcements`; managers add `write:tasks,announcements,materials,task_assignments,validation_rules`.
- Reject any request that lists a table not in the allow-list before calling Supabase.
- Strip `*` selects and force a `LIMIT` in `queryDatabase`.

---

#### M3. RAG retrieve is not source-type-aware

**Files:** `mcp-service/index.ts`, `rag-service/main.py`

The retrieve endpoint scopes by `owner_id = $user_id`. That works for chat attachments but means a manager cannot retrieve a member's submission/task content even when they should. Add a `source_type` parameter and branch on it:

| `source_type`   | Scope                                                |
|-----------------|------------------------------------------------------|
| `chat_attachment` | `owner_id = $user_id`                              |
| `material`      | `team_id IN (user's teams)`                          |
| `submission`    | `team_id IN (user's teams) AND visible_to_role`      |
| `task`          | `team_id IN (user's teams)`                          |
| `announcement`  | `team_id IN (user's teams) OR audience='org'`        |

---

#### M4. Upload endpoint has no size or MIME validation

**File:** `app/api/smart-ai/upload/route.ts`

`MAX_FILE_SIZE_BYTES` and `ACCEPTED_MIME_TYPES` exist in `lib/types.ts` but are not enforced server-side. Any signed-in user can upload any file, push it to R2, and trigger embeddings. Validate before R2 upload and return a 413/415.

---

#### M5. No abort handling on the MCP stream

**File:** `mcp-service/index.ts`

When the client disconnects mid-response, `streamText` keeps generating. Wire `req.signal` (or `req.on('close', ...)` on plain Node) into the call so the upstream LLM call is cancelled and the cost is bounded.

---

#### M6. `application/msword` falls through to `parsePptx`

**File:** `lib/parse/index.ts`

The fallback switch routes `.doc` files into `parsePptx` (officeparser). It mostly works but produces noisy output for legacy Word. Either add an explicit handler or return an unsupported-type warning.

---

#### M7. pgvector index uses `ivfflat` without `ANALYZE`

**File:** `rag-service/main.py` (lifespan)

`ivfflat` recall depends on the index being built after seeding plus `ANALYZE`. In dev it's fine; for production prefer `hnsw`:

```sql
create index on rag_documents using hnsw (embedding vector_cosine_ops);
```

Or run `ANALYZE rag_documents` after the backfill script completes.

---

#### M8. `mcp-service` `pnpm start` script depends on `../.env.local`

**File:** `mcp-service/package.json`

The start script reads `--env-file=../.env.local` which doesn't exist on Railway. It works because `process.env` is populated by Railway, but the flag prints a confusing warning. Drop the flag.

---

#### M9. Health-check badges are derived from env presence, not real probes

**File:** `app/(dashboard)/dashboard/smart-ai/page.tsx`

`services.mcp` and `services.rag` are computed from whether env vars are set. The page can show "Connected" while a service is down. Add a server-side probe (`GET /health` with a 1-second timeout) and pass the real boolean to the shell.

---

#### M10. `convertToModelMessages` is awaited unnecessarily

**File:** `app/api/smart-ai/chat/route.ts`

The function is synchronous in AI SDK 6. Cosmetic, but worth fixing while the file is open.

---

### LOW

- **L1.** `ChatPanel` renders `text || <Loader>` — assistant turns that are pure tool calls show "Thinking…" indefinitely. Render `tool-result` parts.
- **L2.** `analytics-panel.tsx` `hourLabel` is local-time but FastAPI buckets are UTC. Off-by-timezone display.
- **L3.** No client-side enforcement of `MAX_FILE_SIZE_BYTES` in the file picker — feedback is "upload, fail, retry".
- **L4.** Indexer minimum length of 4 chars is too aggressive — most short titles get filtered. 16 is a saner floor.
- **L5.** `lib/smart-ai/indexer.ts` swallows network errors with `console.error`; promote to structured logging so a log aggregator can index them.

---

## 3. Architecture Recommendations

### 3.1. Define one chat-message contract

Today the request body, `UIMessage`, and the persisted row format disagree. Standardize on:

```ts
// transport (chat panel → /api/smart-ai/chat)
type ChatRequest = {
  threadId: string
  message: { id: string; role: 'user'; parts: UIPart[] }
  attachments?: Array<{ id: string; messageId: string; documentId: string }>
}
```

The MCP service hydrates prior messages from DB. The client never has to remember more than the in-flight message.

### 3.2. Centralize role-scoped retrieval in the RAG service

Keep all scope logic in `rag-service/main.py`. The MCP service should pass `{ user_id, role, team_ids, source_type, query, top_k }` and trust the response. This avoids duplicating policies in two languages.

### 3.3. Make the MCP service the only writer to `chat_*` tables

The Next.js layer should never write to `chat_messages`. The upload route can keep writing `chat_attachments` (it already needs the row to exist before indexing), but `chat_threads` should be created lazily by the MCP service on first message. That keeps the persistence contract in one place.

### 3.4. Adopt Vercel AI SDK 6 idioms consistently

- `tool({ inputSchema, execute })`
- `stopWhen: stepCountIs(N)`
- `result.toUIMessageStreamResponse()` everywhere
- `UIMessage.metadata` for any structured per-message extras (attachments, tool-trace IDs)

### 3.5. Observability

Add three log streams:
1. **MCP request log** — `{ threadId, userId, model, tokensIn, tokensOut, toolCalls, durationMs }` per turn.
2. **RAG query log** — `rag_query_log` table already exists; ensure every `searchDocument` call writes one row with `latency_ms` + `chunks_returned`.
3. **Indexer log** — successes vs failures per source type, surfaced on the analytics panel.

---

## 4. Phased Remediation Plan

### Phase 1 — Unblock the system (must-do before deploy)

| Item | Files |
|---|---|
| C1. Add chat tables migration with per-user RLS | `supabase/migrations/<ts>_smart_ai_chat.sql` |
| C2. Migrate MCP tool definitions to AI SDK 6 (`inputSchema`, `stopWhen`) | `mcp-service/supabase-tools.ts`, `mcp-service/index.ts` |
| C3. Wire chat attachments through `UIMessage.metadata` (or top-level body field) | `components/dashboard/smart-ai/chat-panel.tsx`, `app/api/smart-ai/chat/route.ts`, `mcp-service/index.ts` |
| H1. Remove indexer source-type early-return; backfill | `lib/smart-ai/indexer.ts`, run `scripts/backfill-rag-index.ts` |
| H2. Switch MCP persistence to service-role key | `mcp-service/persistence.ts` |

### Phase 2 — Hardening

| Item | Files |
|---|---|
| H3. Fix history hydration contract (server-side hydration) | `mcp-service/index.ts`, `components/dashboard/smart-ai/chat-panel.tsx` |
| H4. Per-user `threadId` + "New conversation" action | `components/dashboard/smart-ai/chat-panel.tsx` |
| H5. Pick one scheduler (Inngest or Upstash) | `lib/inngest/functions.ts`, `lib/upstash-scheduler.ts` |
| M1. Structured MCP error logging + UI fallback warning | `lib/smart-ai/client.ts`, `app/api/smart-ai/chat/route.ts`, chat panel |
| M2. Allow-list table writes in MCP tools by role | `mcp-service/supabase-tools.ts` |
| M3. `source_type`-aware RAG scoping | `mcp-service/index.ts`, `rag-service/main.py` |
| M4. Upload size/MIME validation | `app/api/smart-ai/upload/route.ts` |
| M5. Stream abort handling | `mcp-service/index.ts` |

### Phase 3 — Polish

L1–L5, M9 health-check badges, M10 cosmetic await, M7 hnsw index migration, M6 .doc parser, M8 pnpm start flag.

---

## 5. Risk Summary

If only Phase 1 ships:

- Chat persistence works (C1, H2).
- Tool calling works (C2).
- Attachment-grounded answers work (C3).
- Server-action-driven RAG grounding works (H1).

The system is functionally complete from the user's perspective. Phase 2 prevents quiet data corruption and tightens the security perimeter. Phase 3 is UX/observability.

The single most important fix is **C2** — without it, the entire MCP value proposition (tools) is non-functional regardless of any other change.
