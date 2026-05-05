# Phase 1: Smart AI Security & Stabilization Tasks

- `[x]` 1. Private R2 & Auth-Proxied Chat Attachments
  - `[x]` Update `app/api/smart-ai/upload/route.ts` to store R2 key instead of public URL.
  - `[x]` Add `chat_attachment` branch to `app/api/download/[id]/route.ts` with RLS check.
  - `[x]` Update `chat-panel.tsx` to construct URLs using `/api/download`.
- `[x]` 2. Honest RAG Status Reporting
  - `[x]` Update `lib/smart-ai/indexer.ts` to return `{ ok, reason }`.
  - `[x]` Update `app/api/smart-ai/upload/route.ts` to save correct RAG status (`disabled`, `completed`, `failed`).
  - `[x]` Update `chat-panel.tsx` / `file-preview.tsx` UI to show warning chips for disabled/failed states.
- `[x]` 3. Railway-Safe PDF Parsing
  - `[x]` Replace `tesseract.js` OCR fallback with OpenRouter Gemini Vision in `lib/parse/index.ts`.
  - `[x]` Ensure `parsePdf` throws on terminal failure.
  - `[x]` Add structured logging to `parsePdf`.
- `[x]` 4. Auto-RAG for Chat Attachments
  - `[x]` Update `app/api/smart-ai/chat/route.ts` to inject attachment IDs into `lastUserMsg.content`.
- `[x]` 5. Essential Rate Limiting
  - `[x]` Implement `lib/ratelimit.ts` with Upstash Redis.
  - `[x]` Apply rate limit to `/api/smart-ai/chat`.
  - `[x]` Apply rate limit to `/api/smart-ai/upload`.
