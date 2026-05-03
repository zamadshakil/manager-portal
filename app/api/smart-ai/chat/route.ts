import { NextResponse } from "next/server"
import { streamText, convertToModelMessages, type UIMessage } from "ai"
import { createOpenAI } from "@ai-sdk/openai"
import { requireProfile } from "@/lib/auth"
import {
  scopeForProfile,
  streamChatFromMcp,
  type ChatMessage,
} from "@/lib/smart-ai/client"

// ---------------------------------------------------------------------------
// Provider resolution
//
// Priority for the LLM that powers the fallback path:
//   1. OpenRouter (if OPENROUTER_API_KEY is set) — recommended for prod.
//   2. Vercel AI Gateway (if AI_GATEWAY_API_KEY is set or running on Vercel).
//   3. Bare OpenAI key (legacy).
// ---------------------------------------------------------------------------

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1"
const SMART_AI_MODEL = process.env.SMART_AI_MODEL ?? "openai/gpt-4o-mini"

function resolveModel() {
  if (OPENROUTER_API_KEY) {
    const openrouter = createOpenAI({
      apiKey: OPENROUTER_API_KEY,
      baseURL: OPENROUTER_BASE_URL,
      // Optional but recommended by OpenRouter for analytics + rate-limits.
      headers: {
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL ?? "https://hierarchia.app",
        "X-Title": "Hierarchia Smart AI",
      },
    })
    return openrouter(SMART_AI_MODEL)
  }
  // AI Gateway / direct OpenAI: bare model string is resolved by AI SDK 6.
  return SMART_AI_MODEL
}

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface Body {
  messages: UIMessage[]
}

/**
 * Smart AI chat endpoint.
 *
 * Path 1 (production): forwards the role-scoped request to the Node.js MCP
 *   service on Railway, which orchestrates retrieval through the FastAPI
 *   RAG service (LangChain/LangGraph + pgvector) and streams tokens back.
 *
 * Path 2 (fallback): if the MCP service is not reachable yet, we use the
 *   AI SDK + Vercel AI Gateway to keep the UI streaming-functional. The
 *   model is informed it currently lacks RAG access so its replies stay
 *   conservative.
 */
export async function POST(req: Request) {
  const profile = await requireProfile()

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: "messages array required" }, { status: 400 })
  }

  const scope = scopeForProfile(profile)

  // Flatten UIMessage[] into the simple { role, content } shape the MCP
  // service expects. Anything that isn't user/assistant/system is dropped.
  const flat: ChatMessage[] = body.messages
    .map((m) => {
      const role = m.role
      if (role !== "user" && role !== "assistant" && role !== "system") return null
      const content = (m.parts ?? [])
        .filter((p) => p.type === "text")
        .map((p) => (p as { text: string }).text)
        .join("")
        .trim()
      if (!content) return null
      return { role, content } as ChatMessage
    })
    .filter((m): m is ChatMessage => m !== null)

  // ---- Path 1: MCP service (preferred) ----
  const mcp = await streamChatFromMcp({ scope, messages: flat, signal: req.signal }).catch(
    () => null,
  )
  if (mcp && mcp.body) {
    // The MCP service speaks the AI SDK UI Message Stream protocol so the
    // response can be passed straight through to <useChat>.
    return new Response(mcp.body, {
      status: 200,
      headers: {
        "content-type":
          mcp.headers.get("content-type") ?? "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        "x-smart-ai-source": "mcp",
      },
    })
  }

  // ---- Path 2: AI Gateway fallback ----
  const systemPrompt = [
    "You are Smart AI, an assistant embedded in the Hierarchia manager portal.",
    `The current user is a ${profile.role.replace("_", " ")}` +
      (profile.team_id ? ` on team ${profile.team_id}` : "") +
      ".",
    "When asked about specific submissions, tasks, validation runs, or analytics,",
    "explain that the RAG retrieval service is currently being provisioned and",
    "answer only from what the user has shared in this conversation.",
    "Be concise, neutral, and never invent submission IDs or scores.",
  ].join(" ")

  const result = streamText({
    model: resolveModel(),
    system: systemPrompt,
    messages: await convertToModelMessages(body.messages),
  })

  const res = result.toUIMessageStreamResponse()
  res.headers.set("x-smart-ai-source", "fallback")
  return res
}
