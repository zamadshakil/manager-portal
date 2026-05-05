import { NextResponse } from "next/server"
import { streamText, convertToModelMessages, stepCountIs, tool, type UIMessage } from "ai"
import { createOpenAI, openai } from "@ai-sdk/openai"
import { z } from "zod"
import { requireProfile } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { scopeForProfile } from "@/lib/smart-ai/client"
import { retrieveChunks } from "@/lib/smart-ai/retriever"
import { applySlidingWindow, type SimpleMessage } from "@/lib/smart-ai/sliding-window"
import { chatLimiter } from "@/lib/redis"

// ---------------------------------------------------------------------------
// Provider resolution
//
// Priority for the LLM:
//   1. OpenRouter   (if OPENROUTER_API_KEY is set) — recommended for prod.
//   2. Bare OpenAI  key (legacy).
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
interface PortalUIMessageMetadata {
  attachments?: Array<{ id: string; filename: string }>
}

interface Body {
  messages: UIMessage<PortalUIMessageMetadata>[]
  threadId?: string
}

// ---------------------------------------------------------------------------
// POST /api/smart-ai/chat
//
// Single-path architecture: all AI orchestration, tool use, and RAG
// retrieval happens natively in this Next.js route. No external MCP or
// RAG services needed.
// ---------------------------------------------------------------------------

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

  // ---- Credit gate: monthly/weekly/daily quota check ----
  // We use an admin-level client here so the service-role can auto-advance
  // the period window before reading the usage counter.
  let creditRow: Record<string, any> | null = null
  try {
    const { createClient: createSBClientEarly } = await import("@supabase/supabase-js")
    const _srKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
    const _srUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ""
    if (_srKey && _srUrl) {
      const srClient = createSBClientEarly(_srUrl, _srKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      // Auto-advance period if expired
      await srClient.rpc("maybe_reset_period", { p_user_id: profile.id }).maybeSingle()
      // Fetch credit row
      const { data: cr } = await srClient
        .from("ai_credit_limits")
        .select("*")
        .eq("user_id", profile.id)
        .maybeSingle()
      creditRow = cr as Record<string, any> | null
    }
  } catch (creditErr: any) {
    console.warn("[smart-ai] credit check failed (non-blocking):", creditErr.message)
  }

  if (creditRow && !creditRow.is_unlimited) {
    const used = creditRow.used_this_period ?? 0
    const limit = creditRow.monthly_limit ?? 100
    const remaining = limit - used
    if (remaining <= 0) {
      const periodType = creditRow.period_type ?? "monthly"
      const resetDate = creditRow.period_end ?? "the end of this period"
      return NextResponse.json(
        {
          error: `You have used all ${limit} AI credits for this ${periodType} period. Your credits reset on ${resetDate}. Contact your administrator to increase your limit.`,
        },
        { status: 429 },
      )
    }
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json(
      { error: "messages array required" },
      { status: 400 },
    )
  }

  const scope = scopeForProfile(profile)

  // Flatten UIMessage[] → simple {role, content} for processing
  const flat: { role: string; content: string; metadata?: Record<string, any> }[] = []
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
    const flatMsg: { role: string; content: string; metadata?: Record<string, any> } = { role, content }
    if (hasMeta) flatMsg.metadata = metadata as Record<string, unknown>
    flat.push(flatMsg)
  }

  const supabase = await createClient()

  // ---- Persistence: ensure thread exists in DB ----
  const threadId = body.threadId ?? crypto.randomUUID()
  const lastUserMsg = flat[flat.length - 1]
  const isNewThread = !body.threadId

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


  // Build RLS-scoped tools so the model can query live data.
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
  const tools: Record<string, any> = {
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

    // ---- Native RAG search tool ----
    searchDocument: tool({
      description:
        "Search inside a specific user-uploaded document, material, or other indexed source by ID, or across the user's entire RAG corpus. " +
        "Use this when the user asks about the content of an uploaded file or attached document.",
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
          const chunks = await retrieveChunks({
            scope,
            query,
            documentId: documentId ?? null,
            sourceType: sourceType ?? null,
            topK: 6,
          })
          return { results: chunks, count: chunks.length }
        } catch (err: any) {
          console.error("[smart-ai] searchDocument error:", err.message)
          return { results: [], count: 0 }
        }
      },
    }),
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
      tools,
      stopWhen: stepCountIs(5),
      onFinish: async ({ text, usage }) => {
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

        // ---- Credit accounting: increment usage + log entry ----
        try {
          if (creditRow && !creditRow.is_unlimited) {
            await persistClient
              .from("ai_credit_limits")
              .update({
                used_this_period: (creditRow.used_this_period ?? 0) + 1,
                updated_at: new Date().toISOString(),
              })
              .eq("user_id", profile.id)
          }
          // Always log usage (even for unlimited users — for track record)
          await persistClient.from("ai_usage_log").insert({
            user_id: profile.id,
            thread_id: threadId,
            model: SMART_AI_MODEL,
            tokens_in: usage?.inputTokens ?? null,
            tokens_out: usage?.outputTokens ?? null,
            period_type: creditRow?.period_type ?? "monthly",
          })
        } catch (acctErr: any) {
          console.warn("[smart-ai] credit accounting failed (non-blocking):", acctErr.message)
        }
      },
    })

    const res = result.toUIMessageStreamResponse()
    res.headers.set("x-smart-ai-source", "native")
    return res
  } catch (fallbackError: any) {
    console.error("[smart-ai] streamText failed:", fallbackError.message)
    return new Response(
      `Smart AI is currently unavailable (Error: ${fallbackError.message}). Please try again later or check API key configurations.`,
      { status: 503, headers: { "Content-Type": "text/plain" } }
    )
  }
}
