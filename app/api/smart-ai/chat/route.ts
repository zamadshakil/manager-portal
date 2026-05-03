import { NextResponse } from "next/server"
import { streamText, convertToModelMessages, type UIMessage } from "ai"
import { requireProfile } from "@/lib/auth"
import {
  scopeForProfile,
  streamChatFromMcp,
  type ChatMessage,
} from "@/lib/smart-ai/client"

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
    model: "openai/gpt-5-mini",
    system: systemPrompt,
    messages: await convertToModelMessages(body.messages),
  })

  const res = result.toUIMessageStreamResponse()
  res.headers.set("x-smart-ai-source", "fallback")
  return res
}
