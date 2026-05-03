/**
 * Hierarchia MCP Service
 * ======================
 *
 * Node.js HTTP gateway that the Next.js portal talks to for Smart AI chat.
 * Internally it uses the AI SDK 6 streaming runtime to orchestrate tool
 * calling — Supabase reads/writes via the user's RLS-scoped JWT, plus a
 * `searchDocument` tool that delegates to the FastAPI rag-service for
 * vector retrieval — and streams the result back to the browser using
 * the AI SDK UI Message Stream protocol so the portal's <useChat> hook
 * can consume it directly.
 *
 *     Next.js  ──>  this service (/v1/chat)  ──>  rag-service (/v1/retrieve)
 *                                            └──>  AI Gateway / OpenRouter (LLM)
 *                                            └──>  rag-service (/v1/log/query)
 *
 * Why a separate service?
 *
 *   1. Keeps long-running streams off the Vercel function timeout budget.
 *   2. Lets us hold the service-role Supabase key for thread persistence
 *      without exposing it to the portal.
 *
 * Auth: every request must carry `Authorization: Bearer <MCP_SERVICE_TOKEN>`.
 * The Next route is the only client that holds this secret.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { streamText, stepCountIs, tool, type ModelMessage } from "ai"
import { createOpenAI } from "@ai-sdk/openai"
import { z } from "zod"
import { createSupabaseTools } from "./supabase-tools.js"
import { ChatPersistence } from "./persistence.js"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT ?? 3030)
const MCP_SERVICE_TOKEN = process.env.MCP_SERVICE_TOKEN ?? ""
const RAG_SERVICE_URL = (process.env.RAG_SERVICE_URL ?? "").replace(/\/$/, "")
const RAG_SERVICE_TOKEN = process.env.RAG_SERVICE_TOKEN ?? ""
const MODEL = process.env.SMART_AI_MODEL ?? "openai/gpt-4o-mini"
const MAX_TOP_K = Number(process.env.SMART_AI_TOP_K ?? 6)
const MAX_AGENT_STEPS = Number(process.env.SMART_AI_MAX_STEPS ?? 5)

// LLM provider — OpenRouter when OPENROUTER_API_KEY is set, otherwise the
// AI Gateway / bare OpenAI key. OpenRouter is OpenAI-compatible so we just
// swap the base URL.
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? ""
const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1"

function resolveModel() {
  if (OPENROUTER_API_KEY) {
    const openrouter = createOpenAI({
      apiKey: OPENROUTER_API_KEY,
      baseURL: OPENROUTER_BASE_URL,
      headers: {
        "HTTP-Referer": process.env.SITE_URL ?? "https://hierarchia.app",
        "X-Title": "Hierarchia Smart AI",
      },
    })
    return openrouter.chat(MODEL)
  }
  const openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY ?? "",
    baseURL: process.env.OPENAI_BASE_URL,
  })
  return openai.chat(MODEL)
}

// ---------------------------------------------------------------------------
// Types matching the contract with the Next.js portal
// ---------------------------------------------------------------------------

type UserRole = "main_admin" | "manager" | "member"

interface Scope {
  user_id: string
  role: UserRole
  team_id: string | null
}

interface ChatAttachmentRef {
  id: string
  filename: string
}

interface ChatMessage {
  role: "user" | "assistant" | "system"
  content: string
  metadata?: {
    attachments?: ChatAttachmentRef[]
    [key: string]: unknown
  }
}

interface ChatRequestBody {
  scope: Scope
  accessToken?: string | null
  threadId?: string | null
  messages: ChatMessage[]
  stream?: boolean
}

interface RetrievedChunk {
  id: string
  source_type: string
  source_id: string
  title: string | null
  snippet: string
  score: number
  metadata: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unauthorized(res: ServerResponse, msg = "Unauthorized") {
  res.writeHead(401, { "content-type": "application/json" })
  res.end(JSON.stringify({ error: msg }))
}

function badRequest(res: ServerResponse, msg: string) {
  res.writeHead(400, { "content-type": "application/json" })
  res.end(JSON.stringify({ error: msg }))
}

function serverError(res: ServerResponse, msg: string, code = 500) {
  res.writeHead(code, { "content-type": "application/json" })
  res.end(JSON.stringify({ error: msg }))
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  const raw = Buffer.concat(chunks).toString("utf-8")
  return JSON.parse(raw) as T
}

function authOk(req: IncomingMessage): boolean {
  if (!MCP_SERVICE_TOKEN) return true // dev mode — never deploy without a token
  return req.headers.authorization === `Bearer ${MCP_SERVICE_TOKEN}`
}

async function searchDocument(args: {
  scope: Scope
  documentId?: string
  sourceType?: string
  query: string
  signal?: AbortSignal
}): Promise<RetrievedChunk[]> {
  if (!RAG_SERVICE_URL) return []

  try {
    const res = await fetch(`${RAG_SERVICE_URL}/v1/retrieve`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${RAG_SERVICE_TOKEN}`,
      },
      body: JSON.stringify({
        scope: args.scope,
        document_id: args.documentId ?? null,
        source_type: args.sourceType ?? null,
        query: args.query,
        top_k: MAX_TOP_K,
      }),
      signal: args.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      console.warn(`[mcp] rag retrieve failed (${res.status}): ${text.slice(0, 200)}`)
      return []
    }
    return (await res.json()) as RetrievedChunk[]
  } catch (err) {
    console.warn("[mcp] rag retrieve threw", err)
    return []
  }
}

async function logQuery(args: {
  scope: Scope
  question: string
  sources: number
  latency_ms: number
  tokens_in: number
  tokens_out: number
}): Promise<void> {
  if (!RAG_SERVICE_URL) return
  try {
    await fetch(`${RAG_SERVICE_URL}/v1/log/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${RAG_SERVICE_TOKEN}`,
      },
      body: JSON.stringify(args),
    })
  } catch {
    // Logging is best-effort; never block the user-facing response on it.
  }
}

function buildSystemPrompt(scope: Scope): string {
  const role = scope.role.replace("_", " ")
  return [
    "You are Smart AI, the agentic assistant inside the Hierarchia manager portal.",
    `The current user's role is "${role}". You have access to database tools that run queries on their behalf.`,
    "These tools respect the user's Row Level Security (RLS) policies, so the data you see is the data they're allowed to see.",
    "If the user asks about a specific document (PDF, log, image, transcript), call the 'searchDocument' tool with the document's id to retrieve grounded snippets.",
    "If the user asks about their tasks, submissions, team performance, or announcements, call 'queryDatabase' to look up the real data instead of guessing.",
    "Prefer concrete, cited answers over speculation. If a tool returns no rows, say so plainly.",
    "Never invent IDs, scores, or submission text. If retrieval comes back empty, ask a clarifying question.",
    "If the most recent user message includes attachment metadata (filename + id), those are documents the user has just uploaded; use 'searchDocument' with those IDs and source_type='chat_attachment' before answering.",
  ].join("\n")
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleChat(req: IncomingMessage, res: ServerResponse) {
  if (!authOk(req)) return unauthorized(res)

  let body: ChatRequestBody
  try {
    body = await readJson<ChatRequestBody>(req)
  } catch {
    return badRequest(res, "Invalid JSON body")
  }

  if (!body.scope || !Array.isArray(body.messages) || body.messages.length === 0) {
    return badRequest(res, "scope + non-empty messages required")
  }

  // Hook up the client disconnect to a per-request AbortController so a
  // closed browser tab cancels in-flight LLM and tool work instead of
  // burning tokens against thin air.
  const controller = new AbortController()
  req.on("close", () => {
    if (!res.writableEnded) controller.abort()
  })

  let persistence: ChatPersistence
  try {
    persistence = new ChatPersistence(body.accessToken ?? null)
  } catch (err: any) {
    console.error("[mcp] persistence init failed", err)
    return serverError(res, err?.message ?? "Persistence unavailable", 503)
  }

  let threadId: string
  try {
    threadId = await persistence.ensureThread(body.scope.user_id, body.threadId)
  } catch (err) {
    console.error("[mcp] ensureThread failed", err)
    return serverError(res, "Thread management failed")
  }

  // The portal's <DefaultChatTransport> always sends the full visible
  // history. We DO NOT additionally load DB history here, otherwise the
  // model would see the same turns twice. We only persist new turns.
  const allMessages = body.messages

  // Persist the inbound user message immediately so a mid-stream crash
  // doesn't lose it.
  const lastUserMessage = body.messages[body.messages.length - 1]
  if (lastUserMessage?.role === "user") {
    await persistence.saveMessage(threadId, lastUserMessage)
  }

  const startedAt = Date.now()
  const system = buildSystemPrompt(body.scope)

  // Convert simple {role, content} messages → ModelMessage. Attachments
  // are surfaced as inline context the model can act on via tool calls.
  const modelMessages: ModelMessage[] = allMessages.map((m) => {
    let content = m.content ?? ""
    const atts = m.metadata?.attachments
    if (m.role === "user" && Array.isArray(atts) && atts.length > 0) {
      const list = atts.map((a) => `${a.filename} (id: ${a.id})`).join(", ")
      content +=
        `\n\n[Attached documents on this turn: ${list}. ` +
        `Call searchDocument with these IDs and source_type="chat_attachment" if the question relates to them.]`
    }
    return { role: m.role, content } as ModelMessage
  })

  const supabaseTools = createSupabaseTools({
    accessToken: body.accessToken ?? null,
    role: body.scope.role,
  })

  let sourcesUsed = 0

  try {
    const result = streamText({
      model: resolveModel(),
      system,
      messages: modelMessages,
      // AI SDK 6 replaces v4's `maxSteps` with a stop-condition predicate.
      stopWhen: stepCountIs(MAX_AGENT_STEPS),
      abortSignal: controller.signal,
      tools: {
        ...supabaseTools,
        searchDocument: tool({
          description:
            "Search inside a specific user-uploaded document, material, or other indexed source by ID, or across the user's entire RAG corpus.",
          inputSchema: z.object({
            documentId: z
              .string()
              .optional()
              .describe(
                "UUID of a specific document. Omit to search the user's full corpus.",
              ),
            sourceType: z
              .enum([
                "chat_attachment",
                "material",
                "submission",
                "task",
                "announcement",
                "validation_run",
                "rule",
              ])
              .optional()
              .describe(
                "Restrict search to a single source kind. Use 'chat_attachment' for files uploaded in this conversation.",
              ),
            query: z
              .string()
              .min(1)
              .describe("Natural-language question or keyword to search for."),
          }),
          execute: async ({ documentId, sourceType, query }) => {
            const chunks = await searchDocument({
              scope: body.scope,
              documentId,
              sourceType,
              query,
              signal: controller.signal,
            })
            sourcesUsed += chunks.length
            return { results: chunks, count: chunks.length }
          },
        }),
      },
      onFinish: async ({ usage, text }) => {
        await persistence.saveMessage(threadId, {
          role: "assistant",
          content: text ?? "",
          metadata: { thread_id: threadId },
        })

        await logQuery({
          scope: body.scope,
          question: lastUserMessage?.content ?? "",
          sources: sourcesUsed,
          latency_ms: Date.now() - startedAt,
          tokens_in: usage?.inputTokens ?? 0,
          tokens_out: usage?.outputTokens ?? 0,
        })
      },
    })

    // Pipe the AI SDK UI Message Stream straight to the client.
    const stream = result.toUIMessageStreamResponse()
    const headers = Object.fromEntries(stream.headers)
    headers["x-mcp-thread-id"] = threadId
    res.writeHead(stream.status, headers)
    if (!stream.body) return res.end()
    const reader = stream.body.getReader()
    while (true) {
      if (controller.signal.aborted) break
      const { done, value } = await reader.read()
      if (done) break
      res.write(Buffer.from(value))
    }
    res.end()
  } catch (err) {
    console.error("[mcp] streamText failed", err)
    return serverError(res, "Upstream model error")
  }
}

function handleHealth(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { "content-type": "application/json" })
  res.end(
    JSON.stringify({
      ok: true,
      service: "hierarchia-mcp",
      rag_configured: Boolean(RAG_SERVICE_URL),
      service_role_configured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      model: MODEL,
      max_steps: MAX_AGENT_STEPS,
    }),
  )
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = createServer((req, res) => {
  res.setHeader("access-control-allow-origin", "*")
  res.setHeader("access-control-allow-headers", "content-type, authorization")
  res.setHeader("access-control-allow-methods", "POST, GET, OPTIONS")
  res.setHeader("access-control-expose-headers", "x-mcp-thread-id")

  if (req.method === "OPTIONS") {
    res.writeHead(204)
    return res.end()
  }

  const url = req.url ?? "/"

  if (req.method === "GET" && url === "/health") return handleHealth(req, res)
  if (req.method === "POST" && url === "/v1/chat") {
    handleChat(req, res).catch((err) => {
      console.error("[mcp] /v1/chat threw", err)
      if (!res.headersSent) serverError(res, "Internal error")
    })
    return
  }

  res.writeHead(404, { "content-type": "application/json" })
  res.end(JSON.stringify({ error: "Not found" }))
})

server.listen(PORT, () => {
  console.log(`[mcp] listening on :${PORT}`)
  console.log(`[mcp] rag service: ${RAG_SERVICE_URL || "(not configured)"}`)
  console.log(
    `[mcp] persistence: ${
      process.env.SUPABASE_SERVICE_ROLE_KEY
        ? "service-role"
        : "user-jwt fallback (set SUPABASE_SERVICE_ROLE_KEY for production)"
    }`,
  )
  console.log(`[mcp] model: ${MODEL}`)
  console.log(`[mcp] max agent steps: ${MAX_AGENT_STEPS}`)
})
