# Smart AI Stabilization & Security Hardening Plan

This document outlines a phased, safe approach to resolving the critical issues identified in the system audit. The goal is to close the data leak, repair the RAG document ingestion pipeline, and establish production-grade guardrails without introducing regressions.

## Phase 1: Stop the Bleed (Security + RAG Reliability)

This phase focuses on the most critical, highest-impact issues: stopping the R2 public URL data leak, ensuring RAG correctly reports its status, fixing the PDF OCR pipeline on Railway, and ensuring the LLM actually receives the documents you upload.

### 1. Private R2 & Auth-Proxied Chat Attachments
*   **Goal**: Prevent chat attachments from being exposed via public R2 URLs.
*   **Action**: 
    *   Update `app/api/smart-ai/upload/route.ts` to only store the R2 object key in `chat_documents.file_url`, not the public URL.
    *   Modify `app/api/download/[id]/route.ts` to include a branch for `type=chat_attachment` that enforces RLS ownership checks before generating a signed download URL.
    *   Update `chat-panel.tsx` to construct attachment URLs using the `/api/download` proxy instead of raw R2 URLs.

### 2. Honest RAG Status Reporting
*   **Goal**: Ensure the UI accurately reflects whether a document was successfully ingested by the RAG service.
*   **Action**:
    *   Update `lib/smart-ai/indexer.ts` to return an explicit `{ ok, reason }` object instead of swallowing HTTP errors.
    *   Update the upload route to persist the correct state (`disabled`, `completed`, or `failed`) based on the indexer's return value.
    *   Update the UI to show a warning chip if RAG is disabled or failed, preventing the "Ready" illusion when nothing was indexed.

### 3. Railway-Safe PDF Parsing
*   **Goal**: Ensure PDF OCR fallback works reliably in the Railway Linux container without depending on missing native binaries.
*   **Action**:
    *   Replace `tesseract.js` with a robust Vision LLM fallback (OpenRouter Gemini 2.0 Flash) using `unpdf.renderPageAsImage`. We already have OpenRouter configured, making this approach fast and dependency-free.
    *   Ensure `parsePdf` throws a terminal failure if both text extraction and OCR fail, so the upload route can mark the document as `failed` instead of `skipped` (or `completed`).
    *   Add structured logs to the parsing pipeline for easier debugging in Railway.

### 4. Auto-RAG for Chat Attachments
*   **Goal**: Ensure the LLM always searches uploaded documents before answering.
*   **Action**:
    *   In `app/api/smart-ai/chat/route.ts`, intercept the incoming messages before passing them to `streamText`.
    *   If `lastUserMsg.metadata?.attachments` exists, append a clear block: `[Attached documents]\n- <filename> (id: <id>)` to the user's message content. This ensures the model knows the document IDs exist and triggers the `searchDocument` tool.

### 5. Essential Rate Limiting
*   **Goal**: Protect critical endpoints from abuse and runaway costs.
*   **Action**:
    *   Implement a central `lib/ratelimit.ts` using Upstash Redis.
    *   Apply sliding window limits to `/api/smart-ai/chat` (e.g., 30/min per user) and `/api/smart-ai/upload` (e.g., 20/min per user).

---

## Phase 2: System Hardening

This phase focuses on removing service-role bypasses and tightening access controls.

### 6. Remove Service-Role from Reads
*   Update `/api/smart-ai/threads` and `[id]/messages` GET endpoints to use the user-session client (`createClient()`), relying on standard RLS for authorization instead of service-role keys.

### 7. CSRF / Same-Origin Guards
*   Implement a `withSameOrigin` helper to verify `Origin` or `Referer` headers on all state-changing route handlers (Upload, Chat, etc.), protecting against CSRF attacks.

### 8. Welcome Email Security
*   Remove the plaintext password from the welcome email in `lib/email.ts`.
*   Replace it with a one-time magic link or an instruction to use the "Forgot Password" flow for the first login.

### 9. Tighten Database Query Tool
*   Restrict the `fallbackTools.queryDatabase` `select` argument using a regex to prevent unauthorized embedded resource expansion (`*` or nested joins).

---

## Phase 3: Defense in Depth

This phase adds final polish, stability, and observability.

### 10. Nonce-Based CSP
*   Implement a strictly nonce-based Content Security Policy via Next.js Middleware to eliminate `'unsafe-inline'` script vulnerabilities.

### 11. Circuit Breaker & Retries
*   Implement an in-memory circuit breaker and automated retries with jitter for MCP connection failures to prevent cascading latency during deployments.

### 12. Comprehensive Audit Logging
*   Extend `activity_log` to capture login failures, password resets, and admin role changes.

---

> [!IMPORTANT]
> **User Review Required**
> I recommend that we **execute Phase 1 immediately** as a single pull request. This will completely resolve the public URL leak, fix the PDF RAG issues you experienced, and protect your endpoints. 
> 
> Do you approve proceeding with Phase 1?
