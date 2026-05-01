# AI Validation Pipeline — Architecture

> Last updated: 2026-05-01
> Status: **canonical reference** for the validation pipeline. Supersedes the
> Groq + after() design described in earlier audit reports.

This document explains how a submission gets validated end-to-end, why the
architecture is the way it is, and how to operate it in production.

---

## TL;DR

A submission is validated by a chain of **independent Vercel function
invocations**, each delivered by **Upstash QStash** as a signed webhook.
Each function does one stage of work, persists progress to Redis, and
publishes the next stage. There is no single function that runs the whole
pipeline.

```
Member uploads
    │
    ▼
createSubmission (Server Action)         <-- inserts row, status=queued
    │
    │ POST /api/pipeline/[id]            <-- "trigger" — runs in 30s window
    ▼
enqueueSubmission()                       <-- publishes first stage to QStash
    │
QStash ────────► /api/pipeline/run        stage=parse        (60s budget)
                       │
                       ├── extract text or run Gemini Vision
                       ├── persist extracted_text + state to Redis
                       └── publish stage=validate_batch_0
                       │
QStash ────────► /api/pipeline/run        stage=validate_batch_0  (60s)
                       │
                       ├── run up to 8 rules in parallel against Gemini
                       ├── persist validation_runs rows
                       └── publish stage=validate_batch_1 OR finalize
                       │
                       ... (more batches if needed) ...
                       │
QStash ────────► /api/pipeline/run        stage=finalize     (60s)
                       │
                       ├── aggregate weighted score
                       ├── run summary LLM call
                       └── update submission row -> passed | needs_review |
                                                    failed | late_submitted
```

If any stage throws, QStash retries it with exponential backoff. If retries
exhaust, QStash POSTs to `/api/pipeline/failed` and we mark the submission
`failed` with the underlying error preserved. **A submission can never get
permanently stuck in a non-terminal state.**

---

## Why this design

The previous architecture ran the whole pipeline inside `Next.js after()`,
which is a single serverless invocation with a hard wall-clock limit (60s on
Hobby, 300s on Pro). Three problems compounded:

1. **N grows.** A team with 12 enabled rules, a task brief, and a summary
   call needs ~14 LLM round-trips. At Gemini Flash-Lite's realistic P95
   (~6–10s for structured output), that's 25–40s on a good day, 60s+ on a
   bad one.
2. **Vision is slow.** Image submissions add 10–20s for the vision pass.
3. **Retries amplify.** A 503 from Gemini, plus retry, plus backoff, can
   add 15–30s — inside the same dying function.

Once a function is killed, the work is lost and the row is left in
`validating`. We added a 30-minute cron rescue, but that just hides the
problem. The right answer is **stage chunking**: split the work into
independent function calls, each with a fresh budget.

The four candidate platforms were:
- **QStash** — chosen. Reuses the existing Upstash account.
- **Inngest** — same idea, nicer DX, adds a vendor.
- **BullMQ + dedicated worker** — operationally heavy, overkill for our scale.
- **Just bump Vercel plan** — buys time, doesn't solve the architecture.

QStash gives us: durable retries with exponential backoff, dead-letter
delivery, request signing, deduplication, and a real dashboard.

---

## Stages

State for the in-flight pipeline lives in Redis under
`pipeline:state:{submissionId}` (1-hour TTL) so each stage is idempotent —
re-delivery produces the same result.

### Stage 1 — `parse`

Input: `submissionId`.

1. Read the submission row.
2. If the file is an image, run **Gemini Vision** (`describeImage`) to
   transcribe it. If the file is a document, run the appropriate native
   parser (`pdf-parse`, `mammoth`, `officeparser`).
3. Clamp text to 60 KB and persist it to `submissions.extracted_text` so
   later stages don't have to re-fetch the blob.
4. Build the rule list (team's enabled rules + optional synthetic
   `task:{taskId}` rule from the task brief).
5. Persist `{ extractedText, ruleIds, taskInstructions }` to Redis state.
6. Publish `stage=validate_batch_0`.

If parsing yields zero usable text, we skip directly to `finalize` with
`status=needs_review` and a flag describing why.

### Stage 2 — `validate_batch_N`

Input: `submissionId`, `batchIndex`, `totalBatches`.

1. Load extracted text + rules from Redis state.
2. Pick the rules for this batch (`rules.slice(batchIndex * 8, (batchIndex + 1) * 8)`).
3. Run all rules **in parallel** (up to `LLM_RULE_CONCURRENCY=8`) against
   Gemini Flash-Lite. Each call has a 20s `AbortSignal` timeout and at most
   2 attempts (no retry on permanent errors like `MODEL_NOT_FOUND` or
   schema violations).
4. Insert `validation_runs` rows for the real (non-synthetic) rules.
5. Append per-rule outcomes to Redis state.
6. If more batches remain, publish `stage=validate_batch_{N+1}`.
   Otherwise publish `stage=finalize`.

### Stage 3 — `finalize`

Input: `submissionId`.

1. Load all per-rule outcomes from Redis state.
2. Compute the weighted average score and severity (any hard `fail` →
   `failed`; otherwise `passed` if every rule passed, else `needs_review`).
3. Run the summary LLM call (`generateSummary`) using the same budget guard.
4. **Late preserves late.** If `submissions.is_late = true`, the final
   status is forced to `late_submitted` regardless of LLM verdict (the
   score and summary still reflect the AI judgement and surface in the
   submission detail page).
5. Update `submissions` (`status`, `score`, `summary`, `flags`).
6. Mirror the corresponding `task_assignment` to `submitted` /
   `late_submitted` so manager dashboards reflect status.
7. Delete Redis state. Done.

---

## Failure callback — `/api/pipeline/failed`

QStash includes an `Upstash-Failure-Callback` header on every publish.
When retries exhaust on any stage, QStash POSTs the original message
(plus the upstream error) to this route. The handler:

- Verifies the QStash signature.
- Extracts the `submissionId` and the error message.
- Marks the submission `failed` with a flag like
  `Validation pipeline failed at stage=validate_batch_2: <error>`.
- Releases any Redis lock and clears state.

This is the structural guarantee that **no submission stays in a
non-terminal state forever**.

---

## Module layout

| Module | Role |
|---|---|
| `lib/qstash.ts` | Publish helper + receiver. Falls back to `after()` if QStash creds missing (dev). |
| `lib/llm/pipeline.ts` | Stage handlers (`runParseStage`, `runValidateBatchStage`, `runFinalizeStage`) + Redis state. |
| `lib/llm/validate.ts` | Zod-typed Gemini calls (`evaluateRule`, `generateSummary`, `describeImage`) with per-call timeout + retry. |
| `lib/parse/index.ts` | PDF / DOCX / PPTX text extraction. **Does not handle images** — those go to `describeImage`. |
| `app/api/pipeline/[id]/route.ts` | Trigger endpoint. Calls `enqueueSubmission()` and returns immediately. |
| `app/api/pipeline/run/route.ts` | QStash webhook receiver. Verifies signature, dispatches by stage. |
| `app/api/pipeline/failed/route.ts` | QStash DLQ callback. Marks submission failed. |
| `app/actions/submissions.ts` | `createSubmission` + `retrySubmission` + `deleteSubmission` server actions. |
| `app/api/cron/mark-missed/route.ts` | Belt-and-suspenders: rescues any submission stuck for 30+ min. |

---

## Configuration

All knobs are env-driven; defaults are production-safe.

| Variable | Default | What it does |
|---|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` | (required) | Read by `@ai-sdk/google` automatically. |
| `GEMINI_VALIDATION_MODEL` | `gemini-flash-lite-latest` | Model for rule evaluation. |
| `GEMINI_SUMMARY_MODEL` | `gemini-flash-lite-latest` | Model for the summary stage. |
| `GEMINI_VISION_MODEL` | `gemini-flash-latest` | Model for image OCR. |
| `LLM_CALL_TIMEOUT_MS` | `20000` | Hard timeout per LLM call (30s for vision). |
| `LLM_RULE_CONCURRENCY` | `8` | Rules run in parallel per batch. |
| `PIPELINE_BUDGET_MS` | `50000` | Pipeline-wide AbortController budget. |
| `QSTASH_TOKEN` | (required prod) | Used to publish stage messages. |
| `QSTASH_CURRENT_SIGNING_KEY` | (required prod) | Inbound webhook verification. |
| `QSTASH_NEXT_SIGNING_KEY` | (required prod) | Webhook verification during key rotation. |
| `APP_URL` | (required prod) | Where QStash delivers webhooks. Falls back to `https://${VERCEL_URL}` on previews. |

---

## Operating it in production

### Watching for problems

1. **QStash dashboard.** Filter by destination URL containing
   `/api/pipeline/run`. Healthy = near-zero retries. Spikes in retries
   usually mean Gemini is slow — bumping `LLM_CALL_TIMEOUT_MS` to 30000
   often resolves transient outages without code changes.
2. **DLQ.** Anything in the DLQ for `/api/pipeline/run` represents a
   submission that was marked `failed` by `/api/pipeline/failed`. Inspect
   the original message body to find the submission ID and underlying
   error.
3. **Cron rescue counter.** `/api/cron/mark-missed` returns
   `stuckRecovered` — non-zero values mean something slipped past QStash
   (very rare, usually means Redis state expired before the next stage
   fired). Investigate and bump the Redis state TTL if needed.

### Tuning

- **High volume + 429s from Gemini** → drop `LLM_RULE_CONCURRENCY` to 4.
- **Big PDFs failing parse** → `pdf-parse` is the bottleneck; consider
  off-loading to a dedicated parser worker.
- **Lots of vision passes** → bump `GEMINI_VISION_MODEL` to
  `gemini-2.5-flash` for accuracy or keep `flash-latest` for cost.
- **Many rules per task (15+)** → batches of 8 already cover this; the
  staged pipeline scales linearly without code changes.

### Local dev

`QSTASH_*` is optional in dev. Without it, `lib/qstash.ts` falls back to
running each stage inline via `Next.js after()`. This is fine for local
testing of single-submission flows but **does not exercise the retry/DLQ
behaviour** — for that, set the QStash env vars and use a tunnel
(ngrok / cloudflared) so QStash can reach your local server.

### When to clear Redis state

`pipeline:state:{submissionId}` has a 1-hour TTL. There is no need to
clear it manually. If you ever need to forcibly retry a submission,
`retrySubmission` already deletes any stale state before re-enqueuing.

---

## Idempotency contract

Every stage is required to be **idempotent** — re-delivery (e.g. when
QStash retries) must produce the same result without corrupting data.

The mechanisms that enforce this:

1. **Redis state** is the source of truth for in-flight progress. Each
   stage reads it, makes an additive change, and writes it back.
2. **`validation_runs` upsert** — the (`submission_id`, `rule_id`) pair is
   unique, so re-running a batch overwrites previous attempts.
3. **`submissions.status` transitions** are guarded — `finalize` only
   updates a row that is currently in a non-terminal state.
4. **Idempotency-Key** header on QStash publish (set to
   `{submissionId}:{stage}:{batchIdx}`) prevents duplicate deliveries
   from spawning duplicate work.

If you add a new stage, preserve all four mechanisms.

---

## Migration history

| Date | Change |
|---|---|
| 2026-04-29 | Initial Groq-based pipeline running inside `after()`. |
| 2026-05-01 | Switched provider to Google Gemini; added per-call timeout + budget abort. |
| 2026-05-01 | Migrated to QStash staged pipeline. Removed Tesseract.js (vision-only for images). Added `/api/pipeline/run` and `/api/pipeline/failed`. |

---

## Cross-references

- Operational checklist: [DEPLOYMENT_CHECKLIST.md](../DEPLOYMENT_CHECKLIST.md)
- High-level system overview: [PROJECT_STATUS.md](./PROJECT_STATUS.md)
- Visual diagrams: [ARCHITECTURE_DIAGRAM.md](./ARCHITECTURE_DIAGRAM.md)
