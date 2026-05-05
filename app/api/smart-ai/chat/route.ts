import { NextResponse } from "next/server"
import { streamText, convertToModelMessages, stepCountIs, tool, type UIMessage } from "ai"
import { openai, createOpenAI } from "@ai-sdk/openai"
import { z } from "zod"
import { requireProfile } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import {
  scopeForProfile,
  streamChatFromMcp,
  type ChatMessage,
} from "@/lib/smart-ai/client"
import { applySlidingWindow, type SimpleMessage } from "@/lib/smart-ai/sliding-window"
import { chatLimiter } from "@/lib/redis"

// ---------------------------------------------------------------------------
// Provider resolution
//
// Priority for the LLM that powers the FALLBACK path (when the MCP service
// is unreachable):
//
//   1. OpenRouter   (if OPENROUTER_API_KEY is set) — recommended for prod.
//   2. AI Gateway   (if AI_GATEWAY_API_KEY is set).
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
  // Fall back to the default openai provider (requires OPENAI_API_KEY in env)
  return openai(SMART_AI_MODEL.replace("openai/", ""))
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
 *   SDK directly with tool-based Supabase queries so the model can still
 *   read live data through the user's RLS-scoped session.
 */
export async function POST(req: Request) {
  const profile = await requireProfile()

  const { success } = await chatLimiter().limit(profile.id)
  if (!success) {
    return NextResponse.json(
      { error: "You're sending messages too quickly. Please wait a moment." },
      { status: 429 },
    )
  }

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
  for (let i = 0; i < body.messages.length; i++) {
    const m = body.messages[i]
    const role = m.role
    if (role !== "user" && role !== "assistant" && role !== "system") continue
    let content = (m.parts ?? [])
      .filter(
        (p): p is { type: "text"; text: string } =>
          p.type === "text" && typeof (p as any).text === "string",
      )
      .map((p) => p.text)
      .join("")
      .trim()
    const metadata = m.metadata as PortalUIMessageMetadata | undefined
    const hasMeta = metadata && Object.keys(metadata).length > 0
    
    // Inject attachment context directly into the text so the LLM knows they exist
    if (role === "user" && metadata?.attachments?.length) {
      const lines = metadata.attachments.map(a => `- ${a.filename} (id: ${a.id})`).join("\n")
      content = `${content}\n\n[Attached documents]\n${lines}`.trim()
    }

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
  let mcp: Response | null = null
  let fallbackReason = "mcp-unreachable"

  try {
    mcp = await streamChatFromMcp({
      scope,
      accessToken,
      threadId: body.threadId,
      messages: flat,
      signal: req.signal,
    })
  } catch (err: any) {
    console.error("[smart-ai] mcp fetch threw:", err.message)
    fallbackReason = "mcp-fetch-error"
  }

  if (mcp && mcp.ok && mcp.body) {
    // Pass the AI SDK UI Message Stream straight through to <useChat>.
    const headers = new Headers({
      "content-type": mcp.headers.get("content-type") ?? "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-smart-ai-source": "mcp",
    })
    const threadHeader = mcp.headers.get("x-mcp-thread-id")
    if (threadHeader) headers.set("x-mcp-thread-id", threadHeader)

    return new Response(mcp.body, { status: 200, headers })
  }

  // ---- Path 2: Fallback with direct Supabase tools ----
  if (mcp && !mcp.ok) {
    const text = await mcp.text().catch(() => "")
    console.warn(`[smart-ai] mcp returned error (${mcp.status}): ${text.slice(0, 200)}`)
    fallbackReason = `mcp-status-${mcp.status}`
  }

  if (!process.env.MCP_SERVICE_URL || !process.env.MCP_SERVICE_TOKEN) {
    fallbackReason = "mcp-not-configured"
  }
  console.warn(`[smart-ai] using fallback with tools: ${fallbackReason}`)

  // ---- Persistence: ensure thread exists in DB ----
  // The client sends a threadId (UUID from localStorage). We upsert a
  // matching row so the thread drawer and history loading work correctly.
  const threadId = body.threadId ?? crypto.randomUUID()
  const lastUserMsg = flat[flat.length - 1]
  const isNewThread = !body.threadId

  // Generate a descriptive title from the user's first message
  function generateTitle(msg: string): string {
    if (!msg || msg.trim().length === 0) return "New conversation"
    let t = msg.trim().replace(/[#*_`~\[\]]/g, "").replace(/\[Attached documents[^\]]*\]/g, "").trim()
    const first = t.match(/^[^.!?\n]+[.!?]?/)
    if (first) t = first[0].trim()
    if (t.length > 60) t = t.substring(0, 60).replace(/\s+\S*$/, "") + "…"
    t = t.charAt(0).toUpperCase() + t.slice(1)
    return t || "New conversation"
  }
  const threadTitle = generateTitle(lastUserMsg?.content ?? "")

  // Use service-role client for persistence so RLS doesn't block the insert
  // when the thread is brand-new (user_id must match auth.uid() under anon,
  // but upsert with service-role bypasses RLS). Fall back to the user's
  // RLS-scoped client if service-role key is unavailable.
  const { createClient: createSBClient } = await import("@supabase/supabase-js")
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ""
  const persistClient =
    serviceRoleKey && supabaseUrl
      ? createSBClient(supabaseUrl, serviceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : supabase

  // Check if thread exists; create if not.
  const { data: existingThread } = await persistClient
    .from("chat_threads")
    .select("id")
    .eq("id", threadId)
    .maybeSingle()

  if (!existingThread) {
    const { error: threadErr } = await persistClient
      .from("chat_threads")
      .insert({ id: threadId, user_id: profile.id, title: threadTitle })

    if (threadErr) {
      console.error("[smart-ai] thread insert failed:", threadErr.message, threadErr.code)
    }
  }

  // ---- Persistence: save user message ----
  if (lastUserMsg?.role === "user") {
    // Build the insert payload — only include metadata if non-empty, for
    // resilience against schemas missing the metadata column.
    const msgPayload: Record<string, unknown> = {
      thread_id: threadId,
      role: "user",
      content: lastUserMsg.content ?? "",
    }
    if (lastUserMsg.metadata && Object.keys(lastUserMsg.metadata).length > 0) {
      msgPayload.metadata = lastUserMsg.metadata
    }

    const { error: msgErr } = await persistClient
      .from("chat_messages")
      .insert(msgPayload)

    if (msgErr) {
      console.error("[smart-ai] user message save failed:", msgErr.message, msgErr.code)
    }
  }


  // Build RLS-scoped tools so the model can query live data even without MCP.
  // The user's JWT is used, so RLS enforces team/role scoping automatically.
  //
  // IMPORTANT: This table list MUST stay in sync with READABLE_TABLES in
  // mcp-service/supabase-tools.ts to avoid behavioral differences between
  // the primary (MCP) and fallback paths.
  const ALLOWED_TABLES = [
    "tasks",
    "task_assignments",
    "submissions",
    "validation_runs",
    "validation_rules",
    "announcements",
    "materials",
    "profiles",
    "teams",
    "report_snapshots",
    "activity_log",
    "chat_documents",
  ]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fallbackTools: Record<string, any> = {
    queryDatabase: tool({
      description:
        "Read rows from a permitted database table. RLS automatically restricts results " +
        "to what the current user is allowed to see. " +
        `Permitted tables: ${ALLOWED_TABLES.join(", ")}.`,
      inputSchema: z.object({
        table: z.string().describe("Table name to query, e.g. 'tasks', 'submissions'"),
        select: z.string().default("*").describe("Comma-separated columns to select. Use '*' for all."),
        eq: z
          .array(
            z.object({
              column: z.string(),
              value: z.union([z.string(), z.number(), z.boolean()]),
            }),
          )
          .optional()
          .describe("Optional equality filters."),
        order: z
          .object({
            column: z.string(),
            ascending: z.boolean().default(false),
          })
          .optional()
          .describe("Optional ORDER BY."),
        limit: z.number().int().min(1).max(50).default(10),
      }),
      execute: async ({ table, select, eq, order, limit }) => {
        if (!ALLOWED_TABLES.includes(table)) {
          return { error: `Table "${table}" is not queryable. Permitted: ${ALLOWED_TABLES.join(", ")}.` }
        }

        let builder: any = supabase.from(table).select(select)

        if (eq) {
          for (const f of eq) builder = builder.eq(f.column, f.value as any)
        }

        if (order) {
          builder = builder.order(order.column, { ascending: order.ascending })
        }

        const { data, error: qErr } = await builder.limit(limit)

        if (qErr) {
          console.error(`[smart-ai] queryDatabase(${table}) error: ${qErr.message}`)
          return { error: qErr.message }
        }
        return { data: data ?? [], count: Array.isArray(data) ? data.length : 0 }
      },
    }),
  }

  // Add searchDocument tool if RAG service is configured — this ensures
  // document retrieval works even when the MCP service is down.
  const ragUrl = (process.env.RAG_SERVICE_URL ?? "").replace(/\/$/, "")
  const ragToken = process.env.RAG_SERVICE_TOKEN ?? ""
  if (ragUrl && ragToken) {
    fallbackTools.searchDocument = tool({
      description:
        "Search inside a specific user-uploaded document, material, or other indexed source by ID, or across the user's entire RAG corpus.",
      inputSchema: z.object({
        documentId: z
          .string()
          .optional()
          .describe("UUID of a specific document. Omit to search the user's full corpus."),
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
          .describe("Restrict search to a single source kind."),
        query: z
          .string()
          .min(1)
          .describe("Natural-language question or keyword to search for."),
      }),
      execute: async ({ documentId, sourceType, query }) => {
        try {
          const res = await fetch(`${ragUrl}/v1/retrieve`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${ragToken}`,
            },
            body: JSON.stringify({
              scope,
              document_id: documentId ?? null,
              source_type: sourceType ?? null,
              query,
              top_k: 6,
            }),
            signal: AbortSignal.timeout(8_000),
          })
          if (!res.ok) return { results: [], count: 0 }
          const chunks = await res.json()
          return { results: chunks, count: Array.isArray(chunks) ? chunks.length : 0 }
        } catch {
          return { results: [], count: 0 }
        }
      },
    })
  }

  const roleLabel = profile.role.replace("_", " ")
  const systemPrompt = [
    "You are Smart AI, the agentic assistant inside the Hierarchia manager portal.",
    `The current user's role is "${roleLabel}". You have access to database tools that run queries on their behalf.`,
    "These tools respect the user's Row Level Security (RLS) policies, so the data you see is the data they're allowed to see.",
    "If the user asks about a specific document (PDF, log, image, transcript), call the 'searchDocument' tool with the document's id to retrieve grounded snippets.",
    "If the user asks about their tasks, submissions, team performance, or announcements, call 'queryDatabase' to look up the real data instead of guessing.",
    "CRITICAL TABLE MAPPINGS: 'Team' or 'Departments' -> 'teams', 'Validation Rules' -> 'validation_rules', 'Submission' -> 'submissions'.",
    "CRITICAL TOOL INSTRUCTION: Once you receive tool results, you MUST answer the user immediately in the next step. Do NOT loop or make multiple consecutive tool calls unless absolutely necessary.",
    "Prefer concrete, cited answers over speculation. If a tool returns no rows, say so plainly.",
    "Never invent IDs, scores, or submission text. If retrieval comes back empty, ask a clarifying question.",
    "If the most recent user message includes attachment metadata (filename + id), those are documents the user has just uploaded; use 'searchDocument' with those IDs and source_type='chat_attachment' before answering.",
    "",
    "Key tables and their important columns:",
    "- submissions: id, title, status (queued/passed/failed/needs_review), score, summary, uploader_id, team_id, created_at",
    "- tasks: id, title, instructions, due_date, team_id, created_at",
    "- task_assignments: id, task_id, assignee_id, status (pending/submitted/missed), submitted_at",
    "- profiles: id, email, full_name, role (main_admin/manager/member), team_id",
    "- validation_rules: id, name, prompt, team_id, enabled",
    "- validation_runs: id, submission_id, rule_id, pass, score, reasons, flags",
    "- announcements: id, title, content, author_id, team_id, created_at",
    "- teams: id, name",
    "- activity_log: id, actor_id, action, target_type, target_id, created_at",
    "- report_snapshots: id, team_id, period, data, created_at",
    "- chat_documents: id, user_id, file_name, file_url, rag_status, created_at",
    "",
    "QUERY DECOMPOSITION: For complex questions spanning multiple tables,",
    "break them into sub-queries and make tool calls in consecutive steps.",
    "Once you have ALL data, synthesize a comprehensive answer.",
    "Use at most 3-4 tool calls per question.",
    "",
    "Be concise, format data in tables when useful, and cite specific IDs and scores.",
    "Never invent or fabricate data — only report what the tools return.",
  ].join("\n")

  // --- Sliding window: trim old messages to save tokens on long chats ---
  const trimmedMessages = applySlidingWindow(
    body.messages.map((m: any) => ({
      role: m.role ?? "user",
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""),
      metadata: m.metadata,
    })) as SimpleMessage[],
    { maxTokens: 12_000, recentKeepCount: 6 },
  )

  // Convert trimmed messages to UIMessage format for convertToModelMessages
  const trimmedUIMessages = trimmedMessages.map((m, i) => ({
    ...m,
    id: `trimmed-${i}`,
    parts: [{ type: "text" as const, text: m.content }],
  }))

  try {
    const result = streamText({
      model: resolveModel(),
      system: systemPrompt,
      messages: await convertToModelMessages(trimmedUIMessages as any),
      tools: fallbackTools,
      stopWhen: stepCountIs(5),
      onFinish: async ({ text }) => {
        // ---- Persistence: save assistant reply ----
        if (text) {
          const { error: assistErr } = await persistClient
            .from("chat_messages")
            .insert({
              thread_id: threadId,
              role: "assistant",
              content: text,
            })
          if (assistErr) {
            console.error("[smart-ai] assistant message save failed:", assistErr.message)
          }

          // Auto-title: only update on new threads to avoid overwriting user edits
          if (isNewThread && threadTitle !== "New conversation") {
            await persistClient
              .from("chat_threads")
              .update({ title: threadTitle, updated_at: new Date().toISOString() })
              .eq("id", threadId)
          }
        }
      },
    })

    const res = result.toUIMessageStreamResponse()
    res.headers.set("x-smart-ai-source", "fallback")
    res.headers.set("x-smart-ai-fallback-reason", fallbackReason)
    return res
  } catch (fallbackError: any) {
    console.error("[smart-ai] fallback streamText failed:", fallbackError.message)
    return new Response(
      `Smart AI is currently unavailable (Fallback error: ${fallbackError.message}). Please try again later or check API key configurations.`,
      { status: 503, headers: { "Content-Type": "text/plain" } }
    )
  }
}
