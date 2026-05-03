/**
 * Hierarchia MCP Service
 * ======================
 *
 * Node.js HTTP gateway that the Next.js portal talks to for Smart AI chat.
 * Internally it uses LangChain/LangGraph to orchestrate retrieval (via the
 * FastAPI rag-service) and LLM completion (via the AI Gateway), then
 * streams the result back to the browser using the AI SDK UI Message
 * Stream protocol so the portal's <useChat> hook can consume it directly.
 *
 *     Next.js  ──>  this service (/v1/chat)  ──>  rag-service (/v1/retrieve)
 *                                            └──>  AI Gateway (LLM)
 *                                            └──>  rag-service (/v1/log/query)
 *
 * Why a separate service? Two reasons:
 *
 *   1. Keeps long-running streams off the Vercel function timeout budget.
 *   2. Lets the LangGraph workflow live in plain Node.js where the
 *      LangChain JS ecosystem is at home, while the portal stays a clean
 *      RSC-first Next app.
 *
 * Auth: every request must carry `Authorization: Bearer <MCP_SERVICE_TOKEN>`.
 * The Next route is the only client that holds this secret.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { streamText, type ModelMessage, tool } from "ai"
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

// LLM provider — OpenRouter when OPENROUTER_API_KEY is set, otherwise the
// AI Gateway / bare OpenAI key. OpenRouter is OpenAI-compatible so we just
// swap the base URL.
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? ""
const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1"

function resolveModel() {
  const openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY ?? "",
    baseURL: process.env.OPENAI_BASE_URL, // Optional AI Gateway
  })

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

interface ChatMessage {
  role: "user" | "assistant" | "system"
  content: string
  metadata?: Record<string, any>
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

function serverError(res: ServerResponse, msg: string) {
  res.writeHead(500, { "content-type": "application/json" })
  res.end(JSON.stringify({ error: msg }))
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  const raw = Buffer.concat(chunks).toString("utf-8")
  return JSON.parse(raw) as T
}

function authOk(req: IncomingMessage): boolean {
  if (!MCP_SERVICE_TOKEN) return true // dev mode
  return req.headers.authorization === `Bearer ${MCP_SERVICE_TOKEN}`
}

async function searchDocument(args: {
  scope: Scope
  documentId: string
  query: string
}): Promise<RetrievedChunk[]> {
  if (!RAG_SERVICE_URL) return []

  const res = await fetch(`${RAG_SERVICE_URL}/v1/retrieve`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${RAG_SERVICE_TOKEN}`,
    },
    body: JSON.stringify({
      scope: args.scope,
      document_id: args.documentId, // We'll update the Python backend to accept this
      query: args.query,
      top_k: MAX_TOP_K,
    }),
  })
  if (!res.ok) return []
  return (await res.json()) as RetrievedChunk[]
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
  await fetch(`${RAG_SERVICE_URL}/v1/log/query`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${RAG_SERVICE_TOKEN}`,
    },
    body: JSON.stringify(args),
  }).catch(() => {
    // Logging is best-effort; never block the user-facing response on it.
  })
}

function buildSystemPrompt(scope: Scope): string {
  const role = scope.role.replace("_", " ")
  return [
    "You are Smart AI, the agentic assistant inside the Hierarchia manager portal.",
    `The current user's role is "${role}". You have access to database tools that run queries on their behalf.`,
    "These tools respect the user's Row Level Security (RLS) policies, so you can safely use them to query or modify data.",
    "If the user asks about a specific document (e.g. PDF), use the 'searchDocument' tool to retrieve relevant sections.",
    "If the user asks about their tasks, submissions, or team members, use the 'queryDatabase' tool to look up the real data.",
    "Always use the database tools to fetch real-time information instead of making up answers.",
    "When modifying data via insertRecord or updateRecord, ask for confirmation or just execute if the user is explicit.",
    "If you see attachment IDs in the message metadata, those are documents the user has pinned to this conversation. Use 'searchDocument' with those IDs if the user's question relates to them.",
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

  const persistence = new ChatPersistence(body.accessToken ?? null)
  let threadId: string
  try {
    threadId = await persistence.ensureThread(body.scope.user_id, body.threadId)
  } catch (err) {
    return serverError(res, "Thread management failed")
  }

  // Load history if we're in an existing thread and the portal only sent the latest turn.
  // If the portal sends full history, we skip this to avoid duplication.
  const history = (body.threadId && body.messages.length === 1) 
    ? await persistence.getMessages(threadId) 
    : []
    
  const allMessages = [...history, ...body.messages]
  
  // Save the incoming user message to persistence
  const lastUserMessage = body.messages[body.messages.length - 1]
  if (lastUserMessage.role === "user") {
    await persistence.saveMessage(threadId, lastUserMessage)
  }

  const startedAt = Date.now()
  const system = buildSystemPrompt(body.scope)

  // Convert simple chat messages → ModelMessage.
  const modelMessages: ModelMessage[] = allMessages.map((m) => {
    let content = m.content
    if (m.role === "user" && m.metadata?.attachments) {
      const attachments = m.metadata.attachments as Array<{ id: string; filename: string }>
      const list = attachments.map((a) => `${a.filename} (id: ${a.id})`).join(", ")
      content += `\n\n[Context: The user has attached the following documents to this message: ${list}. If needed, use the searchDocument tool with these IDs to answer questions about them.]`
    }
    return {
      role: m.role,
      content,
    }
  })

  const supabaseTools = createSupabaseTools(body.accessToken ?? null)

  let sourcesUsed = 0

  try {
    const result = streamText({
      model: resolveModel(),
      system,
      messages: modelMessages,
      maxSteps: 5, // Allow the agent to use multiple tools in sequence
      tools: {
        ...supabaseTools,
        searchDocument: tool({
          description: "Search inside a specific user-provided document or material by ID to answer questions about its content.",
          parameters: z.object({
            documentId: z.string().describe("The UUID or source_id of the document to search inside."),
            query: z.string().describe("The question or search query to look for in the document."),
          }),
          execute: async ({ documentId, query }) => {
            sourcesUsed += 1
            return await searchDocument({ scope: body.scope, documentId, query })
          },
        }),
      },
      onFinish: async ({ usage, text }) => {
        // Save the assistant's response to persistence
        await persistence.saveMessage(threadId, {
          role: "assistant",
          content: text,
        })

        await logQuery({
          scope: body.scope,
          question: lastUserMessage.content,
          sources: sourcesUsed,
          latency_ms: Date.now() - startedAt,
          tokens_in: usage?.inputTokens ?? 0,
          tokens_out: usage?.outputTokens ?? 0,
        })
      },
    })

    // Pipe the AI SDK UI Message Stream straight to the client.
    const stream = result.toUIMessageStreamResponse()
    res.writeHead(stream.status, Object.fromEntries(stream.headers))
    if (!stream.body) return res.end()
    const reader = stream.body.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(decoder.decode(value, { stream: true }))
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
      model: MODEL,
    }),
  )
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = createServer((req, res) => {
  // CORS — only the portal should call us, but we keep it open during dev.
  res.setHeader("access-control-allow-origin", "*")
  res.setHeader("access-control-allow-headers", "content-type, authorization")
  res.setHeader("access-control-allow-methods", "POST, GET, OPTIONS")

  if (req.method === "OPTIONS") {
    res.writeHead(204)
    return res.end()
  }

  const url = req.url ?? "/"

  if (req.method === "GET" && url === "/health") return handleHealth(req, res)
  if (req.method === "POST" && url === "/v1/chat") {
    handleChat(req, res).catch((err) => {
      console.error("[mcp] /v1/chat threw", err)
      serverError(res, "Internal error")
    })
    return
  }

  res.writeHead(404, { "content-type": "application/json" })
  res.end(JSON.stringify({ error: "Not found" }))
})

server.listen(PORT, () => {
  console.log(`[mcp] listening on :${PORT}`)
  console.log(`[mcp] rag service: ${RAG_SERVICE_URL || "(not configured)"}`)
  console.log(`[mcp] model: ${MODEL}`)
})
