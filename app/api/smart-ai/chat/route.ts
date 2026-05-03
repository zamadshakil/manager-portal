import { NextResponse } from "next/server"
import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from "ai"
import { createOpenAI } from "@ai-sdk/openai"
import { requireProfile } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import {
  scopeForProfile,
  streamChatFromMcp,
  type ChatMessage,
} from "@/lib/smart-ai/client"

// ---------------------------------------------------------------------------
// Provider resolution
//
// Priority for the LLM that powers the FALLBACK path (when the MCP service
// is unreachable):
//
//   1. OpenRouter   (if OPENROUTER_API_KEY is set) — recommended for prod.
//   2. AI Gateway   (if AI_GATEWAY_API_KEY is set or running on Vercel).
//   3. Bare OpenAI  key (legacy).
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
      headers: {
        "HTTP-Referer":
          process.env.NEXT_PUBLIC_SITE_URL ?? "https://hierarchia.app",
        "X-Title": "Hierarchia Smart AI",
      },
    })
    return openrouter.chat(SMART_AI_MODEL)
  }
  return SMART_AI_MODEL
}

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// The portal-side metadata shape the chat panel attaches to user turns.
// MUST stay in sync with the panel + the mcp-service.
interface PortalUIMessageMetadata {
  attachments?: Array<{ id: string; filename: string }>
}

interface Body {
  messages: UIMessage<PortalUIMessageMetadata>[]
  threadId?: string
}

/**
 * Smart AI chat endpoint.
 *
 * Path 1 (production): forwards the role-scoped request to the Node.js MCP
 *   service on Railway, which orchestrates retrieval through the FastAPI
 *   RAG service and streams tokens back via the AI SDK UI Message Stream
 *   protocol.
 *
 * Path 2 (fallback): if the MCP service is not reachable, we use the AI
 *   SDK directly to keep the UI streaming-functional. The model is told
 *   it currently lacks RAG access so its replies stay conservative.
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
    return NextResponse.json(
      { error: "messages array required" },
      { status: 400 },
    )
  }

  const scope = scopeForProfile(profile)

  // Flatten UIMessage[] → simple {role, content, metadata} the MCP service
  // expects. Anything that isn't user/assistant/system is dropped.
  const flat: ChatMessage[] = []
  for (const m of body.messages) {
    const role = m.role
    if (role !== "user" && role !== "assistant" && role !== "system") continue
    const content = (m.parts ?? [])
      .filter(
        (p): p is { type: "text"; text: string } =>
          p.type === "text" && typeof (p as any).text === "string",
      )
      .map((p) => p.text)
      .join("")
      .trim()
    const metadata = m.metadata as PortalUIMessageMetadata | undefined
    const hasMeta = metadata && Object.keys(metadata).length > 0
    if (!content && !hasMeta) continue
    const flatMsg: ChatMessage = { role, content }
    if (hasMeta) flatMsg.metadata = metadata as Record<string, unknown>
    flat.push(flatMsg)
  }

  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const accessToken = session?.access_token ?? null

  // ---- Path 1: MCP service (preferred) ----
  const mcp = await streamChatFromMcp({
    scope,
    accessToken,
    threadId: body.threadId,
    messages: flat,
    signal: req.signal,
  })

  if (mcp && mcp.body) {
    // Pass the AI SDK UI Message Stream straight through to <useChat>.
    const headers = new Headers({
      "content-type":
        mcp.headers.get("content-type") ?? "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-smart-ai-source": "mcp",
    })
    const threadHeader = mcp.headers.get("x-mcp-thread-id")
    if (threadHeader) headers.set("x-mcp-thread-id", threadHeader)

    return new Response(mcp.body, { status: 200, headers })
  }

  // ---- Path 2: AI Gateway fallback ----
  // Surface why we fell back so operators don't have to grep logs blind.
  const fallbackReason =
    !process.env.MCP_SERVICE_URL || !process.env.MCP_SERVICE_TOKEN
      ? "mcp-not-configured"
      : "mcp-unreachable"
  console.warn(`[smart-ai] using fallback: ${fallbackReason}`)

  const systemPrompt = [
    "You are Smart AI, an assistant embedded in the Hierarchia manager portal.",
    `The current user is a ${profile.role.replace("_", " ")}` +
      (profile.team_id ? ` on team ${profile.team_id}` : "") +
      ".",
    "When asked about specific submissions, tasks, validation runs, or analytics,",
    "explain that the RAG retrieval service is currently unreachable and",
    "answer only from what the user has shared in this conversation.",
    "Be concise, neutral, and never invent submission IDs or scores.",
  ].join(" ")

  const result = streamText({
    model: resolveModel(),
    system: systemPrompt,
    messages: await convertToModelMessages(body.messages),
    stopWhen: stepCountIs(1),
  })

  const res = result.toUIMessageStreamResponse()
  res.headers.set("x-smart-ai-source", "fallback")
  res.headers.set("x-smart-ai-fallback-reason", fallbackReason)
  return res
}
