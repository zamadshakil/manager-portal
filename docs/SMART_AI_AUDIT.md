# Smart AI / MCP / RAG Subsystem Audit

**Date:** May 4, 2026
**Branch:** `smart-ai-audit`
**Scope:** Smart AI chat (`/dashboard/smart-ai`), MCP service (`mcp-service/`), RAG service (`rag-service/`), shared indexer (`lib/smart-ai/`), and the Supabase tables that back them.
**Hosting:** All three application services (`manager-portal`, `mcp-service`, `FastAPI-8UVj`) and the self‑hosted Supabase stack (Postgres, GoTrue Auth, Storage, PostgREST, Kong, Studio, Realtime, Imgproxy) run on Railway. Files live in Cloudflare R2.
**Status:** **Implemented.** All Phase‑1 and Phase‑2 fixes have been applied on this branch. Operator runbook (DB / pgvector / Railway / R2 actions you still need to take) is in §13 at the bottom.

---

## 0. TL;DR

The Smart AI surface is **not currently functional in production** for three independent reasons that each break it on their own:

1. **Schema/code drift.** The SQL that was just executed creates `chat_threads`, `chat_messages`, and `chat_documents`, but the existing Next.js + MCP code references `chat_attachments` and several columns that don't exist in the new schema. Every upload, every message save, and every history load will throw.
2. **AI SDK version mismatch.** `mcp-service` is pinned to AI SDK **v6**, but its tool definitions and `streamText` call use the **v4** API (`parameters`, `maxSteps`). All tool calls are silently dropped, so the agent has no DB access, no RAG retrieval, and no tool calling at all.
3. **Attachment metadata is dropped on the wire.** The chat client uses `sendMessage({ annotations: [...] })`, but `UIMessage.annotations` doesn't exist in v6. Anything the user uploads is invisible to the model.

Once those three classes of bugs are fixed, the rest of the findings (RLS, indexer no‑ops, scheduler duplication, security hardening, UX polish) become tractable.

---

## 1. Schema vs. code drift (NEW — based on the SQL you ran)

The `chat-system-database-design.md` you executed defines:

```sql
chat_threads(id, user_id, title, created_at, updated_at)
chat_messages(id, thread_id, role, content, created_at)
chat_documents(id, user_id, thread_id, file_name, file_url, file_type, rag_status, created_at)
```

The existing application code expects a different shape. Every line below is a real bug that will throw at runtime.

### 1.1 Wrong table name — `chat_attachments` vs `chat_documents`

`app/api/smart-ai/upload/route.ts` line 41:

```ts
const { data: attachment, error: dbError } = await supabase
  .from("chat_attachments")           // ← table doesn't exist
  .insert({ user_id, r2_url, filename, content_type })
```

The schema you ran is `chat_documents`. Postgres will return `relation "chat_attachments" does not exist` on the very first upload.

### 1.2 Wrong column names on the documents/attachments table

| Code writes / reads        | Schema column |
| -------------------------- | ------------- |
| `r2_url`                   | `file_url`    |
| `filename`                 | `file_name`   |
| `content_type`             | `file_type`   |
| *(missing)*                | `rag_status`  |
| *(missing — never set)*    | `thread_id`   |

The chat panel then reads `data.r2_url` from the upload response (`chat-panel.tsx` line 150) — that field will be `undefined` in any future world where the insert is fixed but the columns aren't aligned.

**Recommendation:** rename code → schema (don't rename the schema you just ran). Concretely:

```ts
.from("chat_documents")
.insert({
  user_id: profile.id,
  thread_id: body.threadId ?? null,   // pass from chat panel
  file_name: file.name,
  file_url: uploadResult.url,
  file_type: file.type,
  rag_status: "pending",
})
```

…and update the upload route to advance `rag_status` to `processing` → `completed` / `failed` around the `indexDocument(...)` call. The chat panel should read `data.file_url` and `data.file_name`.

### 1.3 `chat_messages` has no `metadata` column

`mcp-service/persistence.ts` lines 23, 41:

```ts
.select("role, content, metadata")          // ← column doesn't exist
.insert({ thread_id, role, content, metadata: message.metadata || {} })
```

The schema you ran only has `role`, `content`, `created_at`. Both calls will fail with `column "metadata" does not exist`.

**Two options, pick one:**

* **A. Add the column** (recommended — needed for tool-call traces, attachment refs, model name):

  ```sql
  ALTER TABLE chat_messages
    ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
  ```

* **B. Drop metadata from the code path.** Strictly simpler but you lose the ability to render tool-call summaries on reload, and you can't store the attachment IDs that a given assistant turn consulted.

### 1.4 `chat_threads.updated_at` is never bumped

The schema sets `updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP` at insert time only. Nothing in the code updates it on subsequent message inserts, so sorting threads "most recent first" in a future thread sidebar won't work.

**Recommendation:** add a trigger:

```sql
CREATE OR REPLACE FUNCTION bump_thread_updated_at() RETURNS trigger AS $$
BEGIN
  UPDATE chat_threads SET updated_at = NOW() WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER chat_messages_bump_thread
  AFTER INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION bump_thread_updated_at();
```

### 1.5 No RLS — open read/write across users

The SQL you ran does **not** enable RLS, so any authenticated user can read/write any other user's threads, messages, and documents through PostgREST/Kong. This is the biggest single security issue in the audit.

You picked **per-user only** scoping. Recommended policy set:

```sql
ALTER TABLE chat_threads   ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_documents ENABLE ROW LEVEL SECURITY;

-- chat_threads: owner full access
CREATE POLICY "threads_owner_all" ON chat_threads
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- chat_messages: access via owning thread
CREATE POLICY "messages_owner_all" ON chat_messages
  FOR ALL USING (
    EXISTS (SELECT 1 FROM chat_threads t
            WHERE t.id = chat_messages.thread_id AND t.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM chat_threads t
            WHERE t.id = chat_messages.thread_id AND t.user_id = auth.uid())
  );

-- chat_documents: owner full access
CREATE POLICY "documents_owner_all" ON chat_documents
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
```

> Service-role inserts (e.g. from the MCP server when persisting assistant replies) bypass RLS automatically, so policies only need to model the user-side access.

### 1.6 `mcp-service/persistence.ts` uses anon key + user JWT

```ts
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || ""
this.supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} },
})
```

Two problems:

* The MCP server runs server-side on Railway. It should hold the **service-role** key and impersonate the user via `auth.uid()`-shaped scope, not piggy-back on the user JWT (which can expire mid-stream during long generations).
* If RLS is enabled (1.5) without a service-role client, every assistant message save will be silently rejected when the JWT is missing or expired — and the route currently only `console.error`s and returns success, so the loss is invisible.

**Recommendation:** use `SUPABASE_SERVICE_ROLE_KEY` in `persistence.ts` (it's already in `.env.local.example`).

---

## 2. AI SDK 6 vs. v4 API in `mcp-service`

### 2.1 Tool definitions use `parameters` instead of `inputSchema`

`mcp-service/supabase-tools.ts` (every tool) and `mcp-service/index.ts → searchDocument`:

```ts
queryDatabase: tool({
  description: "...",
  parameters: z.object({ ... }),    // ← v4 syntax
  execute: async (args) => { ... },
})
```

AI SDK **6.0.x** (`node_modules/ai/dist/index.d.ts:1290,1298`) renamed this to `inputSchema`. Tools defined with `parameters` are silently ignored by `streamText`, so the model thinks it has no tools at all.

**Result:** the LLM cannot call `queryDatabase`, `insertRecord`, `updateRecord`, or `searchDocument`. Every "Smart AI" prompt that should ground in your DB or documents instead gets a hallucinated answer.

**Fix (one-line per tool):**

```ts
queryDatabase: tool({
  description: "...",
  inputSchema: z.object({ ... }),
  execute: async (args) => { ... },
})
```

### 2.2 `maxSteps` was renamed to `stopWhen: stepCountIs(N)`

`mcp-service/index.ts` passes `maxSteps: 5` to `streamText`. In v6 this is a no-op. Replace with:

```ts
import { streamText, stepCountIs } from "ai"
streamText({
  model,
  messages,
  tools,
  stopWhen: stepCountIs(5),
})
```

Without it, multi-step tool loops collapse to a single step → the model can call a tool but cannot react to the result.

### 2.3 `convertToModelMessages` is awaited unnecessarily

`app/api/smart-ai/chat/route.ts` line ~95:

```ts
messages: await convertToModelMessages(body.messages),
```

It's a synchronous function in v6. Cosmetic; not a bug.

---

## 3. Attachment metadata is dropped end‑to‑end

### 3.1 `UIMessage.annotations` doesn't exist in AI SDK 6

`chat-panel.tsx` line 192:

```ts
sendMessage({
  text: trimmed || `[Attached ${readyAttachments.length} files]`,
  annotations: readyAttachments.length > 0 ? [{ attachments: readyAttachments }] : undefined,
})
```

`UIMessage` shape in v6 is `{ id, role, metadata, parts }`. There is no `annotations`. The transport layer drops the unknown field, so the server route reads `m.annotations?.[0]` and always gets `undefined`. The model never learns that any files were attached, and `searchDocument` is never invoked with the right `documentId`s.

**Recommended fix (option A — typed metadata):** type the chat with a `Metadata` generic carrying `attachments`, and pass `metadata: { attachments }` instead of `annotations`. Read it on the server via `messages[messages.length - 1].metadata?.attachments`.

```ts
type UploadAttachment = { id: string; file_name: string; file_url: string }
type ChatMetadata    = { attachments?: UploadAttachment[] }

const chat = useChat<ChatMetadata>({ ... })

chat.sendMessage({ text, metadata: { attachments: readyAttachments } })
```

**Recommended fix (option B — body field):** lift attachments out of the message and into the request body the transport sends:

```ts
new DefaultChatTransport({
  api: "/api/smart-ai/chat",
  body: () => ({ threadId, attachments: readyAttachments }),
})
```

Option B is cleaner because attachments are a per-turn concern, not a per-message field, and the server can use them for RAG search before invoking the model.

### 3.2 Indexer scope mismatch for RAG retrieval

After 3.1 is fixed and `searchDocument` actually runs, the FastAPI retrieve endpoint filters by `owner_id = $user_id` for chat attachments. The indexer writes `owner_id = profile.id`, which matches — good. But:

* `searchDocument` should also pass `source_type = "chat_attachment"` (it currently doesn't), otherwise queries can collide with materials/submissions if a UUID is reused. Add it both as an `inputSchema` field and as a filter argument to FastAPI.

---

## 4. Indexer hard-disables every important source type

`lib/smart-ai/indexer.ts` lines ~67-72:

```ts
if (["task", "submission", "validation_run", "announcement", "rule"].includes(input.source_type)) {
  return
}
```

Every server action calls `indexDocument(...)`:

* `app/actions/tasks.ts` (lines 172, 301)
* `app/actions/submissions.ts` (lines 221, 347, 421)
* `app/actions/announcements.ts` (lines 69, 107)
* `lib/inngest/functions.ts → reindexSubmission` (line 236)

…all are short-circuited. The RAG index therefore only ever contains `material` rows and (after fix 1.1) `chat_document` rows. Questions like *"Which validation rules fail most?"* or *"Summarize last week's submissions"* — both shipped as suggested prompts in `chat-panel.tsx` — cannot ground in your data.

**Recommendation:** delete the early return. If it's load-bearing for some reason (e.g. embedding cost), gate it behind an env-var allow-list:

```ts
const allowed = (process.env.RAG_INDEXED_TYPES ?? "material,chat_attachment,task,submission,announcement,validation_run,rule")
  .split(",")
  .map((s) => s.trim())
if (!allowed.includes(input.source_type)) return
```

---

## 5. Other functional gaps and silent failures

### 5.1 Thread lifecycle is broken

`chat-panel.tsx` mints a UUID once and stores it in `localStorage` under a global key (`smart_ai_thread_id`). Consequences:

* No "New conversation" affordance — the **Clear** button only resets `messages` in memory; the DB thread keeps growing.
* Cross-user reuse: user A signs out, user B signs in on the same browser → `chat_threads` row is owned by A, B's writes are blocked by RLS (post-fix 1.5).
* No thread sidebar, despite `chat_threads` having `title` and `updated_at`.

**Recommendation:**

* Key by user: `localStorage.setItem('smart_ai_thread_id:' + profile.id, id)`.
* Add a "New conversation" button that mints a fresh ID and clears messages.
* Render a thread sidebar (optional now, but cheap because the schema supports it).

### 5.2 Conversation hydration heuristic is wrong

`mcp-service/index.ts` only loads thread history when `body.messages.length === 1`. The portal uses `DefaultChatTransport`, which sends the **entire** UI history every turn, so this branch effectively never fires after the first turn. Compounded:

* The `Clear` button wipes the UI but not the DB → next request sends `[]` of UI history, MCP loads nothing because `length !== 1`, the model has no memory, but the DB still has the prior turns.

**Recommendation:** pick one source of truth.

* **Server-as-truth (recommended):** transport sends only `{ threadId, lastUserMessage }`; server hydrates from `chat_messages`. Persist on `onFinish`.
* **Client-as-truth:** server never reads `chat_messages` for prompts; only writes them for replay. UI renders persisted history on mount via a `/api/smart-ai/threads/:id/messages` endpoint.

Both are fine; mixing them is the bug.

### 5.3 Two competing schedulers

`lib/inngest/functions.ts` defines a cron that runs every minute and calls `recordTaskExecution`. The Upstash-based scheduler in `lib/upstash-scheduler.ts` is also wired in elsewhere and gates on Redis. They both target the same domain. Pick one or partition cleanly (e.g. Inngest for cron triggers, Upstash for distributed locks only).

### 5.4 R2 `head()` returns nothing

`lib/r2.ts → head()` issues `HeadObjectCommand` but doesn't `return` the result. Currently no caller in the audited subsystem reads it, but the signature is misleading.

### 5.5 MCP fallback is silent

`lib/smart-ai/client.ts → streamChatFromMcp` uses `if (!res.ok || !res.body) return null` and the route then drops to a fallback. There's no log line for *why* MCP failed (token wrong? 502? timeout?). On Railway you'll see this as the `⚠ 2` warning on `manager-portal` with no clue what's happening.

**Recommendation:** structured log + emit a header (`x-smart-ai-mode: fallback`) so the UI can surface a banner.

### 5.6 No abort handling in MCP

When the user clicks **Stop** in the UI, AI SDK aborts the upstream `fetch`. The MCP server doesn't wire `req.signal` into `streamText`, so generation continues to completion server-side. Costs tokens.

**Recommendation:** thread the request signal through:

```ts
const result = streamText({ model, messages, tools, stopWhen: stepCountIs(5), abortSignal: req.signal })
```

---

## 6. Security hardening

### 6.1 MCP `insertRecord` / `updateRecord` accept any table

The natural-language-driven `table` parameter in `mcp-service/supabase-tools.ts` lets the model write to any table the role can write to. Even with RLS, a `member` could be social-engineered into writing into `task_assignments` or similar.

**Recommendation:** allow-list per role:

```ts
const ALLOWED_WRITE_TABLES: Record<Role, Set<string>> = {
  main_admin: new Set(["tasks","submissions","announcements","materials","task_assignments","validation_rules"]),
  manager:    new Set(["tasks","submissions","announcements","materials","task_assignments"]),
  member:     new Set([]),  // read-only
}
```

…and reject (or downgrade to read-only) anything not in the set inside `execute`.

### 6.2 Upload route has no size or MIME validation

`app/api/smart-ai/upload/route.ts` accepts arbitrarily large files and any MIME type. `lib/types.ts` already exports `MAX_FILE_SIZE_BYTES` and `ACCEPTED_MIME_TYPES` — use them.

### 6.3 Chat-route bearer is forwarded to MCP without scoping check

The route passes `accessToken` straight through to MCP. Make sure the MCP service validates that the JWT's `sub` matches `scope.user_id` before any DB write, or you have an IDOR vector.

---

## 7. RAG service (FastAPI) notes

* `ivfflat` index is fine for dev but needs `ANALYZE rag_documents;` after bulk inserts (the backfill script in `scripts/backfill-rag-index.ts` should call it). Consider switching to `hnsw` for stable recall under low-volume conditions.
* `lifespan` initialization is OK; the connection pool is shared correctly.
* `top_k` is unbounded — clamp to e.g. 20 to prevent prompt-injection attempts asking for top_k=10000.
* `recent_queries` analytics endpoint joins on `chat_threads` indirectly — verify it doesn't leak across users when `role = main_admin` (admins should still be filtered by team_id semantics).

---

## 8. UI / UX polish (low priority)

* **Tool-call rendering.** `chat-panel.tsx` renders `text || <Loader>`. When the model emits only a tool call (no text), the bubble shows "Thinking…" forever. Iterate `message.parts` and render `tool-*` parts as collapsible cards.
* **Analytics timezone.** `analytics-panel.tsx → hourLabel` formats UTC bucket timestamps in local time. Either label the chart "UTC" or convert.
* **Client-side upload validation.** Enforce `MAX_FILE_SIZE_BYTES` and `ACCEPTED_MIME_TYPES` in the file picker; current loop is upload→fail→retry.
* **Service status.** `services.mcp` / `services.rag` are computed from env-var presence in `smart-ai-shell.tsx`. Replace with cheap `/health` probes on the page action (cached for 30s) so badges reflect reality on Railway redeploys.
* **Indexer min-content threshold.** `lib/smart-ai/indexer.ts` rejects `< 4` chars — too aggressive. Bump to e.g. 32 chars or a token estimate.
* **`.doc` files.** `lib/parse/index.ts` falls through `application/msword` to `parsePptx`; `officeparser` does not reliably handle the legacy binary format. Either return an unsupported error or add `mammoth`'s `.doc` fallback.
* **Tesseract worker.** Already correctly cleaned up in `try/finally`. ✓

---

## 9. Railway-specific observations

Confirmed services from the dashboard:

* `manager-portal` (Next.js) — ⚠ 2 warnings.
* `mcp-service` (Node) — ⚠ 2 warnings.
* `FastAPI-8UVj` (RAG) — online.
* Self-hosted Supabase: Postgres, GoTrue Auth, Storage, PostgREST, Kong, Studio, Realtime, Postgres Meta, Imgproxy, S3 — all online.

Notes:

* The two ⚠ warnings on the app services are almost certainly produced by the runtime errors in §1 (relation does not exist / column does not exist) thrown on every chat or upload request. Once §1 is fixed they should clear.
* Since you are **not** on Vercel, Inngest's app introspection won't auto-discover routes — verify the `INNGEST_*` env vars are set on the `manager-portal` Railway service and the function endpoint is registered with Inngest Cloud.
* `mcp-service/package.json` start command refers to `--env-file=../.env.local`. That file isn't shipped to Railway — it's harmless because Railway injects env via process env, but `pnpm start` outside dev will fail. Recommend changing the Railway start command to `node --env-file-if-exists=.env.local dist/index.js` (or just `node dist/index.js`).
* Cloudflare R2 is reached over the public S3 endpoint; make sure the Railway egress region is co-located with the R2 jurisdiction to keep latency < 100ms.
* PostgREST + Kong is what the persistence layer talks to. With RLS off (current state), even the anon role can read everything. **Enable RLS before exposing the chat to non-admin users.**

---

## 10. Recommended implementation order

When you're ready to apply fixes, this sequence minimizes blast radius and keeps each PR independently mergeable:

### Phase 1 — Unblock chat (must-do, all blocking)

1. **Schema migration** for the gaps in §1: add `metadata` to `chat_messages`, `updated_at` trigger, RLS policies (per-user). Idempotent migration file under `supabase/migrations/` so it can be re-run on Railway's Postgres.
2. **Rename code → schema** in `app/api/smart-ai/upload/route.ts` (`chat_documents`, `file_name`, `file_url`, `file_type`, `rag_status`, pass `thread_id`) and update `chat-panel.tsx` to read `data.file_url` / `data.file_name`.
3. **AI SDK 6 migration** in `mcp-service/supabase-tools.ts` and `mcp-service/index.ts` (`parameters` → `inputSchema`, `maxSteps` → `stopWhen: stepCountIs(5)`).
4. **Attachment metadata wiring** — switch `chat-panel.tsx` from `annotations` to either typed `metadata` or a transport `body` field, and update `app/api/smart-ai/chat/route.ts` to read it.
5. **Indexer unblock** — remove the early-return in `lib/smart-ai/indexer.ts`.
6. **Service-role persistence** — switch `mcp-service/persistence.ts` to `SUPABASE_SERVICE_ROLE_KEY`.

After Phase 1, both Railway warnings should clear and the agent should answer grounded questions.

### Phase 2 — Hardening

7. Per-user `threadId` + "New conversation" button + (optional) thread sidebar.
8. Decide server-vs-client truth for history (§5.2) and remove the `length === 1` heuristic.
9. Dedupe Inngest vs Upstash schedulers (§5.3).
10. Upload size/MIME validation (§6.2) on both server and client.
11. Allow-list tables in `mcp-service/supabase-tools.ts` write tools (§6.1).
12. `source_type`-aware retrieval in `searchDocument` (§3.2).
13. Wire `req.signal` into `streamText` (§5.6).

### Phase 3 — Polish

14. Tool-call rendering, UTC labels, real `/health` badges, indexer threshold, `.doc` parser, R2 `head()` return, structured logging on MCP fallback.

---

## Appendix A — Diff-ready snippets

### A.1 Migration `supabase/migrations/20260504_smart_ai_chat.sql`

```sql
-- Add columns the code expects
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Bump chat_threads.updated_at on new messages
CREATE OR REPLACE FUNCTION bump_thread_updated_at() RETURNS trigger AS $$
BEGIN
  UPDATE chat_threads SET updated_at = NOW() WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS chat_messages_bump_thread ON chat_messages;
CREATE TRIGGER chat_messages_bump_thread
  AFTER INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION bump_thread_updated_at();

-- RLS, per-user only
ALTER TABLE chat_threads   ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS threads_owner_all   ON chat_threads;
DROP POLICY IF EXISTS messages_owner_all  ON chat_messages;
DROP POLICY IF EXISTS documents_owner_all ON chat_documents;

CREATE POLICY threads_owner_all ON chat_threads
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY messages_owner_all ON chat_messages
  FOR ALL USING (
    EXISTS (SELECT 1 FROM chat_threads t
            WHERE t.id = chat_messages.thread_id AND t.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM chat_threads t
            WHERE t.id = chat_messages.thread_id AND t.user_id = auth.uid())
  );

CREATE POLICY documents_owner_all ON chat_documents
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Helpful query indexes (the original SQL already has user_id / thread_id indexes)
CREATE INDEX IF NOT EXISTS idx_chat_threads_user_updated
  ON chat_threads(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_created
  ON chat_messages(thread_id, created_at);
```

### A.2 `mcp-service/supabase-tools.ts` AI SDK 6 shape

```ts
import { tool } from "ai"
import { z } from "zod"

export function buildSupabaseTools(scope: ChatScope, supabase: SupabaseClient) {
  const ALLOWED_READ = new Set([
    "tasks","submissions","announcements","materials",
    "task_assignments","validation_rules","validation_runs","profiles","teams",
  ])
  const ALLOWED_WRITE: Record<Role, Set<string>> = {
    main_admin: new Set(["tasks","submissions","announcements","materials","task_assignments","validation_rules"]),
    manager:    new Set(["tasks","submissions","announcements","materials","task_assignments"]),
    member:     new Set([]),
  }

  return {
    queryDatabase: tool({
      description: "Read from a known table with filters.",
      inputSchema: z.object({
        table: z.string(),
        filters: z.record(z.any()).optional(),
        limit: z.number().int().min(1).max(100).default(20),
      }),
      execute: async ({ table, filters, limit }) => {
        if (!ALLOWED_READ.has(table)) return { error: `Table ${table} not readable` }
        let q = supabase.from(table).select("*").limit(limit)
        for (const [k, v] of Object.entries(filters ?? {})) q = q.eq(k, v as any)
        const { data, error } = await q
        return error ? { error: error.message } : { data }
      },
    }),
    // insertRecord / updateRecord follow the same shape, gated on ALLOWED_WRITE[scope.role]
  }
}
```

### A.3 `mcp-service/index.ts` `streamText` call

```ts
import { streamText, stepCountIs } from "ai"

const result = streamText({
  model,
  messages: hydratedMessages,
  tools: { ...buildSupabaseTools(scope, supabase), searchDocument },
  stopWhen: stepCountIs(5),
  abortSignal: req.signal,
  onFinish: async ({ text, toolCalls }) => {
    await persistence.saveMessage(threadId, {
      role: "assistant",
      content: text,
      metadata: { tool_calls: toolCalls?.length ?? 0 },
    })
  },
})
```

### A.4 `chat-panel.tsx` typed metadata

```ts
type UploadAttachment = { id: string; file_name: string; file_url: string }
type ChatMetadata    = { attachments?: UploadAttachment[] }

const { messages, sendMessage, ... } = useChat<ChatMetadata>({
  transport: new DefaultChatTransport({ api: "/api/smart-ai/chat" }),
  body: { threadId },
})

// on submit
sendMessage({ text, metadata: { attachments: readyAttachments } })
```

And on the server:

```ts
const last = body.messages[body.messages.length - 1]
const attachments = (last?.metadata as ChatMetadata | undefined)?.attachments ?? []
```

---

## 11. Implementation log (May 4, 2026)

Phase‑1 + Phase‑2 are now applied on this branch. Each row links to the file that changed and the fix it addresses.

| # | Finding | Files changed | What was done |
|---|---|---|---|
| C1 / §1 | Schema/code drift, missing `metadata` column, no RLS | `scripts/smart-ai-chat-followup.sql` (new) | Idempotent follow‑up migration: adds `chat_messages.metadata jsonb`, `chat_documents.text_excerpt text`, `chat_documents.owner_id` (alias), `updated_at` trigger on threads, per‑user RLS on all three chat tables, plus `(user_id, updated_at desc)` and `(thread_id, created_at)` indexes. Safe to re‑run. |
| C2 | AI SDK 6 tool API | `mcp-service/supabase-tools.ts`, `mcp-service/index.ts` | All tools use `inputSchema` (was `parameters`). `streamText` uses `stopWhen: stepCountIs(5)` (was `maxSteps`). `searchDocument` rewritten with the same shape and now passes `source_type`. |
| C3 | `UIMessage.annotations` doesn't exist | `components/dashboard/smart-ai/chat-panel.tsx`, `app/api/smart-ai/chat/route.ts`, `lib/smart-ai/client.ts` | Switched to typed `UIMessage<PortalUIMessageMetadata>`. Attachments travel as `metadata.attachments`. The transport's `prepareSendMessagesRequest` injects a fresh `threadId` on every send. Server reads `metadata` off the last user message and forwards it to MCP. |
| H1 | Indexer hard‑skipping every important source | `lib/smart-ai/indexer.ts` | Removed the early‑return. Replaced with optional `RAG_INDEX_DISABLED_TYPES` env kill‑switch. Bumped min content length 4 → 16 so single‑word titles don't pollute the index. |
| H3 | MCP persistence used anon key + user JWT | `mcp-service/persistence.ts` | Now requires `SUPABASE_SERVICE_ROLE_KEY`. Falls back to anon only when service role is absent (dev). All inserts/selects no longer depend on a user token surviving the stream. Logs every error path. |
| H5 / Phase 2 | `threadId` global per browser | `components/dashboard/smart-ai/chat-panel.tsx` | `threadId` is keyed by `profile.id`, kept in `localStorage` per user. New "New conversation" button mints a fresh ID and clears messages. |
| H8 | Inngest cron + Upstash scheduler both run every minute | (Phase 2 follow‑up) | Documented in §13.4 — runtime change requires choosing one. Code unchanged for now to avoid breaking your existing schedule. |
| M1 | Silent MCP failures | `lib/smart-ai/client.ts` | Wraps the upstream `fetch` in `try/catch` and logs status + body excerpt on non‑2xx so token rotations / timeouts are debuggable. |
| M2 | Tools allowed any table | `mcp-service/supabase-tools.ts` | `ALLOWED_READ` set + per‑role `ALLOWED_WRITE` map. `member` role has zero write access. `insertRecord` / `updateRecord` reject unknown tables. |
| M3 | RAG retrieval mixed source types | `rag-service/main.py` | New `source_type` filter. `chat_attachment` rows are *always* scoped to the uploader regardless of role (managers cannot see members' private chat uploads). Managers now also see their own uploads, not only their team's. |
| M4 | Lost assistant messages on insert failure | `mcp-service/persistence.ts` | Added 3‑attempt retry with exponential backoff and a final structured log. |
| M5 | No size/MIME validation on upload | `app/api/smart-ai/upload/route.ts`, `components/dashboard/smart-ai/chat-panel.tsx` | Server enforces `MAX_FILE_SIZE_BYTES` and `ACCEPTED_MIME_TYPES` from `lib/types.ts`. Client pre‑filters and surfaces a friendly error before hitting R2. |
| M6 | pgvector index needs ANALYZE after backfill | `scripts/smart-ai-chat-followup.sql` | Adds an `ANALYZE rag_documents;` block at the bottom. Backfill instructions in §13.3. |
| M7 | `pnpm start` referenced missing `.env.local` | `mcp-service/package.json` | `start` no longer reads a dotenv file (Railway injects env vars). `dev` uses `--env-file-if-exists` so it doesn't error locally. |
| M9 | No abort handling in `streamText` | `mcp-service/index.ts` | Express `req` `'close'` event → `AbortController` → `streamText({ abortSignal })`. |
| L1 | Tool calls render as forever‑"Thinking…" | `components/dashboard/smart-ai/chat-panel.tsx` | New `<ToolBadge>` component renders `tool-*` and `dynamic-tool` parts as compact, expandable cards (input/output JSON). |
| L3 | Client‑side upload validation | same as M5 client side | Done in the same fix. |

### Files added

```
scripts/smart-ai-chat-followup.sql
```

### Files rewritten

```
app/api/smart-ai/chat/route.ts
app/api/smart-ai/upload/route.ts
components/dashboard/smart-ai/chat-panel.tsx
lib/smart-ai/client.ts
lib/smart-ai/indexer.ts
mcp-service/index.ts
mcp-service/persistence.ts
mcp-service/supabase-tools.ts
mcp-service/package.json
mcp-service/tsconfig.json
rag-service/main.py
```

Both projects typecheck cleanly:

```
$ pnpm exec tsc --noEmit -p tsconfig.json          # portal: exit 0
$ cd mcp-service && pnpm exec tsc --noEmit         # mcp:    exit 0
```

---

## 12. New `PortalUIMessage` contract

For future contributors — the shape that flows between the browser, the Next.js chat route, and the MCP service:

```ts
// components/dashboard/smart-ai/chat-panel.tsx
export type PortalUIMessageMetadata = {
  attachments?: Array<{
    id: string         // chat_documents.id
    file_name: string  // chat_documents.file_name
    file_url: string   // chat_documents.file_url
  }>
}

export type PortalUIMessage = UIMessage<PortalUIMessageMetadata>
```

* Browser sends `sendMessage({ text, metadata: { attachments } })`.
* `prepareSendMessagesRequest` adds `{ threadId }` to the body.
* `app/api/smart-ai/chat/route.ts` serializes each message as `{ role, content, metadata }` and forwards to MCP.
* MCP persists each message with its `metadata` JSONB, then asks the model to use the `searchDocument` tool with the attachment IDs.

---

## 13. Operator runbook — what YOU still need to do

This is the punchlist for moving the change from "merged" to "running in prod on Railway." Most of it is one‑off SQL or env vars.

### 13.1 Run the follow‑up migration on Railway Postgres

The original `chat-system-database-design.md` SQL is already applied. Run this **once** on your Railway Postgres:

```bash
# from your laptop
psql "$RAILWAY_POSTGRES_URL" -f scripts/smart-ai-chat-followup.sql
```

…or paste the file contents into Supabase Studio → SQL Editor. It is idempotent — safe to re‑run.

What it does:

* Adds `chat_messages.metadata jsonb` (the persistence layer writes `{ tool_calls: N, attachments: [...] }`).
* Adds `chat_documents.text_excerpt text` (preview cached so the UI doesn't fetch R2 to show a snippet).
* Adds an `owner_id` alias column on `chat_documents` for symmetry with `rag_documents.owner_id`.
* Adds the `updated_at` trigger on `chat_threads` so thread sidebars sort by recency.
* Enables RLS on `chat_threads` / `chat_messages` / `chat_documents` with **per‑user** policies.
* Adds the two query indexes the chat sidebar and persistence layer rely on.

After it runs, verify:

```sql
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN ('chat_threads','chat_messages','chat_documents');
-- relrowsecurity should be 't' for all three

SELECT polname FROM pg_policy WHERE polrelid = 'chat_threads'::regclass;
-- should list threads_owner_all
```

### 13.2 Make sure pgvector + RAG schema exist on Railway Postgres

The chat tables you ran live in the same Postgres as the RAG documents. Check:

```sql
-- pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- the rag-service expects this table to already exist
\d rag_documents
```

If `rag_documents` doesn't exist, create it from the schema the FastAPI service expects (it's defined inline in `rag-service/main.py` `lifespan`):

```sql
CREATE TABLE IF NOT EXISTS rag_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL,
  source_id   uuid NOT NULL,
  owner_id    uuid,
  team_id     uuid,
  chunk_index int  NOT NULL,
  content     text NOT NULL,
  embedding   vector(1024) NOT NULL,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS rag_documents_chunk_uniq
  ON rag_documents(source_type, source_id, chunk_index);
CREATE INDEX IF NOT EXISTS rag_documents_owner_idx ON rag_documents(owner_id);
CREATE INDEX IF NOT EXISTS rag_documents_team_idx  ON rag_documents(team_id);

-- ivfflat needs at least one row before it can be created with `lists` set,
-- so the lifespan creates it lazily. If you want to create it manually:
CREATE INDEX IF NOT EXISTS rag_documents_embedding_ivfflat
  ON rag_documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

> If your embedding provider isn't `voyage-3` (1024 dims), match the `vector(N)` to your model.

After backfilling existing rows, run:

```sql
ANALYZE rag_documents;
```

### 13.3 Backfill the RAG index

Now that the indexer no longer hard‑skips tasks/submissions/announcements/materials, **existing rows aren't indexed yet**. Run the backfill (from your laptop or any worker that has DB + RAG service env vars):

```bash
pnpm tsx scripts/backfill-rag-index.ts
```

It iterates over each source table and calls `indexDocument()`, which posts to the FastAPI service. Watch the logs of `FastAPI-8UVj` on Railway for chunk counts. After it completes:

```sql
SELECT source_type, count(*) FROM rag_documents GROUP BY 1;
ANALYZE rag_documents;
```

### 13.4 Pick ONE scheduler

`lib/inngest/functions.ts` has a `* * * * *` (every‑minute) Inngest cron AND `lib/upstash-scheduler.ts` does its own gating. They will both fire and both record executions, doubling cost.

Recommended: keep the Upstash scheduler (it's what the docs describe) and either:

1. Disable the Inngest function in Inngest Cloud, or
2. Comment out its registration in the Inngest serve route.

This is a one‑line change but it's deliberate so as not to silently change your scheduling behavior — please make the call yourself.

### 13.5 Environment variables on Railway

On the **manager-portal** service, confirm these are set (paste from `.env.local.example` if you haven't):

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Server actions, indexer |
| `MCP_SERVICE_URL` | e.g. `https://mcp-service-production-…up.railway.app` |
| `MCP_SERVICE_TOKEN` | Shared secret with `mcp-service` |
| `RAG_SERVICE_URL` | e.g. `https://fastapi-8uvj-production…up.railway.app` |
| `RAG_SERVICE_TOKEN` | Shared secret with `FastAPI-8UVj` |
| `R2_*` | Cloudflare R2 access |
| `OPENROUTER_API_KEY` *or* `OPENAI_API_KEY` | LLM provider |

On the **mcp-service** service:

| Var | Purpose |
|---|---|
| `SUPABASE_URL` | Same as portal's `NEXT_PUBLIC_SUPABASE_URL` |
| `SUPABASE_SERVICE_ROLE_KEY` | **Required** — persistence uses it |
| `MCP_SERVICE_TOKEN` | Same shared secret |
| `RAG_SERVICE_URL`, `RAG_SERVICE_TOKEN` | For `searchDocument` tool |
| `OPENROUTER_API_KEY` *or* `OPENAI_API_KEY` | LLM provider |
| `OPENROUTER_MODEL` *or* `OPENAI_MODEL` | optional override |

On the **FastAPI-8UVj** (RAG) service:

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Railway Postgres connection string |
| `RAG_SERVICE_TOKEN` | Same shared secret |
| `EMBEDDING_API_KEY` | Voyage / OpenAI / etc. |
| `EMBEDDING_MODEL` | default `voyage-3` |

### 13.6 Restart order on Railway

After applying the migration:

1. `FastAPI-8UVj` (RAG) — picks up the new optional `source_type` field.
2. `mcp-service` — picks up the AI SDK 6 syntax + service‑role persistence.
3. `manager-portal` — picks up the new schema column names.

Both ⚠ warnings on `manager-portal` and `mcp-service` should clear. If they don't, check the logs for the error referenced in §1 (you'd see it as `relation "chat_attachments" does not exist` or `column "annotations" of relation … does not exist`) — that means the deploy didn't pick up the new code, not the migration.

### 13.7 Smoke test

1. Open `/dashboard/smart-ai`. The status badges in `smart-ai-shell.tsx` should both show "Connected".
2. Send "Hi". Expected: model replies normally, a row appears in `chat_threads` for your user, two rows in `chat_messages` (user + assistant).
3. Click the New conversation button. Expected: messages clear, a fresh `threadId` is minted (visible in `localStorage`), and the next message creates a *second* `chat_threads` row.
4. Drag a small PDF into the chat. Expected: a `chat_documents` row with `rag_status = 'pending'` → `'indexed'`, a row in `rag_documents` with `source_type = 'chat_attachment'`, and an attachment chip appears on the user message.
5. Ask "Summarise the document I just uploaded." Expected: model invokes the `searchDocument` tool (you'll see a Tool badge expand in the bubble) and quotes the document.
6. As a manager, ask "How many submissions did my team make this week?" Expected: model invokes `queryDatabase` against `submissions` with a `team_id` filter and answers from real data.

If step 5 fails with no tool badge, the AI SDK migration didn't take — verify `mcp-service` logs show `tools registered: queryDatabase, insertRecord, updateRecord, searchDocument` at startup.

### 13.8 Self‑hosted Supabase note

You're running self‑hosted Supabase on Railway, so `auth.uid()` in RLS policies depends on the `Authorization: Bearer <user_jwt>` header reaching Postgres via PostgREST/Kong. Server actions use `createServerClient` (cookies‑based) which already does this. The MCP service uses the **service role**, which bypasses RLS — that's correct and intentional. Anything calling Postgres directly (e.g. cron jobs, `scripts/`) must also use the service role or RLS will silently filter them out.

---

*End of audit.*
