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
import { streamText, type ModelMessage } from "ai"
import { createOpenAI } from "@ai-sdk/openai"

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
  return MODEL
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
}

interface ChatRequestBody {
  scope: Scope
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

// ---------------------------------------------------------------------------
// LangGraph-style retrieval pipeline.
//
// Kept as a plain async function for clarity. When the workflow grows
// (rerankers, query rewriting, multi-hop tool use), promote this to a
// proper LangGraph state graph.
// ---------------------------------------------------------------------------

async function retrieveContext(args: {
  scope: Scope
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

function buildPrompt(args: { scope: Scope; chunks: RetrievedChunk[] }): string {
  const role = args.scope.role.replace("_", " ")
  const context =
    args.chunks.length === 0
      ? "(no documents retrieved — answer only from the conversation)"
      : args.chunks
          .map(
            (c, i) =>
              `[#${i + 1} ${c.source_type}:${c.source_id}${
                c.title ? ` — ${c.title}` : ""
              }]\n${c.snippet}`,
          )
          .join("\n\n")
  return [
    "You are Smart AI, the assistant inside the Hierarchia manager portal.",
    `The current user's role is "${role}". Honor their access level — never reveal data outside their scope.`,
    "Cite retrieved chunks inline using their #N marker. If no chunks were retrieved, say so plainly.",
    "Be concise, factual, and never invent submission IDs, scores, or names.",
    "",
    "Retrieved context:",
    context,
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

  const userQuestion =
    [...body.messages].reverse().find((m) => m.role === "user")?.content ?? ""

  const startedAt = Date.now()
  const chunks = await retrieveContext({ scope: body.scope, query: userQuestion }).catch(
    () => [] as RetrievedChunk[],
  )

  const system = buildPrompt({ scope: body.scope, chunks })

  // Convert simple chat messages → ModelMessage. The portal already gives us
  // a clean { role, content } shape so no UIMessage conversion is needed.
  const modelMessages: ModelMessage[] = body.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }))

  try {
    const result = streamText({
      model: resolveModel(),
      system,
      messages: modelMessages,
      onFinish: async ({ usage }) => {
        await logQuery({
          scope: body.scope,
          question: userQuestion,
          sources: chunks.length,
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
