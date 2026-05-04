import { NextResponse } from "next/server"
import { streamText, convertToModelMessages, stepCountIs, tool, type UIMessage } from "ai"
import { createOpenAI } from "@ai-sdk/openai"
import { z } from "zod"
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
 *   SDK directly with tool-based Supabase queries so the model can still
 *   read live data through the user's RLS-scoped session.
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
  const threadTitle =
    lastUserMsg?.content?.slice(0, 60)?.replace(/\n/g, " ")?.trim() || "New conversation"

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
    const { error: msgErr } = await persistClient
      .from("chat_messages")
      .insert({
        thread_id: threadId,
        role: "user",
        content: lastUserMsg.content ?? "",
        metadata: lastUserMsg.metadata ?? {},
      })

    if (msgErr) {
      console.error("[smart-ai] user message save failed:", msgErr.message)
    }
  }

  // Build RLS-scoped tools so the model can query live data even without MCP.
  // The user's JWT is used, so RLS enforces team/role scoping automatically.
  const fallbackTools = {
    queryDatabase: tool({
      description:
        "Read rows from a database table. RLS automatically restricts results " +
        "to what the current user is allowed to see. " +
        "Available tables: submissions, tasks, task_assignments, profiles, " +
        "validation_rules, announcements, teams, activity_log, materials.",
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
        const ALLOWED_TABLES = [
          "submissions", "tasks", "task_assignments", "profiles",
          "validation_rules", "announcements", "teams", "activity_log",
          "materials",
        ]
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

  const roleLabel = profile.role.replace("_", " ")
  const systemPrompt = [
    "You are Smart AI, an intelligent assistant embedded in the Hierarchia manager portal.",
    `The current user is a ${roleLabel}` +
      (profile.team_id ? ` on team ${profile.team_id}` : "") +
      ".",
    "",
    "You have access to a queryDatabase tool that lets you read live portal data.",
    "USE THIS TOOL to answer questions about submissions, tasks, assignments,",
    "validation rules, announcements, team performance, and activity logs.",
    "",
    "When a user asks about their data, ALWAYS use the queryDatabase tool to fetch",
    "the actual records. Never say you cannot access data — you CAN query it directly.",
    "CRITICAL TABLE MAPPINGS: 'Team' or 'Departments' -> 'teams', 'Validation Rules' -> 'validation_rules', 'Submission' -> 'submissions'.",
    "CRITICAL TOOL INSTRUCTION: Once you receive tool results, you MUST answer the user immediately in the next step. Do NOT loop or make multiple consecutive tool calls unless absolutely necessary.",
    "",
    "Key tables and their important columns:",
    "- submissions: id, title, status (queued/passed/failed/needs_review), score, summary, uploader_id, team_id, created_at",
    "- tasks: id, title, instructions, due_date, team_id, created_at",
    "- task_assignments: id, task_id, assignee_id, status (pending/submitted/missed), submitted_at",
    "- profiles: id, email, full_name, role (main_admin/manager/member), team_id",
    "- validation_rules: id, name, prompt, team_id, enabled",
    "- announcements: id, title, content, author_id, team_id, created_at",
    "- teams: id, name",
    "- activity_log: id, actor_id, action, target_type, target_id, created_at",
    "",
    "Be concise, format data in tables when useful, and cite specific IDs and scores.",
    "Never invent or fabricate data — only report what the queryDatabase tool returns.",
  ].join("\n")

  const result = streamText({
    model: resolveModel(),
    system: systemPrompt,
    messages: await convertToModelMessages(body.messages),
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
            metadata: {},
          })
        if (assistErr) {
          console.error("[smart-ai] assistant message save failed:", assistErr.message)
        }

        // Update thread title to first user message if this is the first exchange
        if (lastUserMsg?.content && threadTitle !== "New conversation") {
          await persistClient
            .from("chat_threads")
            .update({ title: threadTitle })
            .eq("id", threadId)
        }
      }
    },
  })

  const res = result.toUIMessageStreamResponse()
  res.headers.set("x-smart-ai-source", "fallback")
  res.headers.set("x-smart-ai-fallback-reason", fallbackReason)
  return res
}
