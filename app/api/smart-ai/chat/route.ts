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
import { logActivity } from "@/lib/activity"

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
    const { createAdminClient } = await import("@/lib/supabase/admin")
    const srClient = createAdminClient()
    
    // Auto-advance period if expired
    await srClient.rpc("maybe_reset_period", { p_user_id: profile.id }).maybeSingle()

    // Fetch credit row
    const { data: cr, error: fetchErr } = await srClient
      .from("ai_credit_limits")
      .select("*")
      .eq("user_id", profile.id)
      .maybeSingle()

    if (!cr && !fetchErr) {
      // Initialize default row if missing
      const { data: newRow, error: insErr } = await srClient
        .from("ai_credit_limits")
        .insert({
          user_id: profile.id,
          monthly_limit: 100,
          used_this_period: 0,
          period_type: "monthly",
          is_unlimited: profile.role === "main_admin"
        })
        .select()
        .maybeSingle()
      
      if (insErr) {
        console.warn("[smart-ai] could not auto-provision credit row:", insErr.message)
      }
      creditRow = newRow as Record<string, any> | null
    } else {
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

  // ---------------------------------------------------------------------
  // Flatten UIMessage[] → simple {role, content}
  //
  // Two transformations happen here that are critical for RAG to work:
  //
  //  (a) Text is read from `parts[]` (AI SDK v5+ shape), NOT `.content`.
  //      Reading `.content` returns undefined and the model sees an
  //      empty user turn.
  //
  //  (b) Attachments are *propagated across the whole thread*. The chat
  //      panel only attaches `metadata.attachments` to the turn where
  //      the user actually drops the file. Every follow-up question
  //      ("tell me about rag in that document") arrives with empty
  //      metadata, so the LLM had no `documentId` to scope its search
  //      to and `searchDocument` ran against the entire corpus —
  //      resulting in "no mentions of rag in the document" even when
  //      the chunks were sitting right there in pgvector.
  //
  //      Fix: collect every attachment ever mentioned in the thread and
  //      surface them on the *latest* user turn so the LLM always knows
  //      which documents are in scope for the current question.
  // ---------------------------------------------------------------------

  type Attachment = { id: string; filename: string }
  const threadAttachments: Attachment[] = []
  const seenAttachmentIds = new Set<string>()

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

    // Track every attachment that has ever been mentioned in this thread.
    if (metadata?.attachments?.length) {
      for (const a of metadata.attachments) {
        if (a?.id && !seenAttachmentIds.has(a.id)) {
          seenAttachmentIds.add(a.id)
          threadAttachments.push({ id: a.id, filename: a.filename })
        }
      }
    }

    // Inject this turn's attachments inline so the LLM sees the upload
    // in context where it happened.
    if (role === "user" && metadata?.attachments?.length) {
      const lines = metadata.attachments.map(a => `- ${a.filename} (id: ${a.id})`).join("\n")
      content = `${content}\n\n[Attached documents]\n${lines}`.trim()
    }

    if (!content && !hasMeta) continue
    const flatMsg: { role: string; content: string; metadata?: Record<string, any> } = { role, content }
    if (hasMeta) flatMsg.metadata = metadata as Record<string, unknown>
    flat.push(flatMsg)
  }

  // If the most recent user turn has NO attachment metadata of its own
  // but earlier turns did, re-surface the full list so the LLM still
  // knows which documents are available. This is the single biggest
  // RAG-relevance win because it guarantees the model has document IDs
  // to pass to `searchDocument` on every follow-up.
  if (threadAttachments.length > 0) {
    const lastIdx = flat.length - 1
    const lastUser = flat[lastIdx]
    if (lastUser?.role === "user") {
      const ownAttachments =
        (lastUser.metadata as PortalUIMessageMetadata | undefined)?.attachments ?? []
      const ownIds = new Set(ownAttachments.map((a) => a.id))
      const carryover = threadAttachments.filter((a) => !ownIds.has(a.id))
      if (carryover.length > 0) {
        const lines = carryover
          .map((a) => `- ${a.filename} (id: ${a.id})`)
          .join("\n")
        lastUser.content = `${lastUser.content}\n\n[Documents available in this conversation]\n${lines}`.trim()
      }
    }
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
  const { createAdminClient } = await import("@/lib/supabase/admin")
  const persistClient = createAdminClient()

  // Check if thread exists; create if not.
  let threadPersisted = false
  const { data: existingThread } = await persistClient
    .from("chat_threads")
    .select("id")
    .eq("id", threadId)
    .maybeSingle()

  if (existingThread) {
    threadPersisted = true
  } else {
    const { error: threadErr } = await persistClient
      .from("chat_threads")
      .insert({ id: threadId, user_id: profile.id, title: threadTitle })

    if (threadErr) {
      console.error("[smart-ai] thread insert failed:", threadErr.message, threadErr.code)
    } else {
      threadPersisted = true
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
        "Semantic + keyword search inside indexed documents (uploaded files, " +
        "materials, announcements, etc). ALWAYS pass `documentId` when the " +
        "user is asking about a specific document — including follow-up " +
        "questions that refer to a document mentioned earlier in the " +
        "conversation. Document IDs appear in `[Attached documents]` and " +
        "`[Documents available in this conversation]` blocks in the " +
        "conversation history. When the user uploaded a chat attachment, " +
        "also pass `sourceType: 'chat_attachment'` for tighter scoping. " +
        "Pass a focused, content-rich `query` (the user's question, NOT " +
        "the words 'the document'). " +
        "If the first call returns 0 results for a targeted document, " +
        "retry once with a broader `query` (e.g. main topic, key terms) " +
        "before telling the user nothing was found.",
      inputSchema: z.object({
        documentId: z
          .string()
          .optional()
          .describe(
            "UUID of a specific document. REQUIRED whenever the user refers " +
              "to a particular file (including 'this document', 'that PDF', " +
              "'the file I uploaded'). Omit only for searches across the " +
              "user's entire corpus.",
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
            "Restrict to a source kind. Use 'chat_attachment' when the user " +
              "uploaded the document in this chat thread.",
          ),
        query: z
          .string()
          .min(1)
          .describe(
            "Natural-language question or keyword to search for. Use the " +
              "user's actual topic, not pronouns like 'this' or 'that'.",
          ),
      }),
      execute: async ({ documentId, sourceType, query }) => {
        try {
          // Use higher topK for targeted doc searches to get full context.
          const effectiveTopK = documentId ? 20 : 12
          const chunks = await retrieveChunks({
            scope,
            query,
            documentId: documentId ?? null,
            sourceType: sourceType ?? null,
            topK: effectiveTopK,
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
    
    // --- COMMUNICATION STYLE ---
    "COMMUNICATION STYLE:",
    "- Act as a polished, professional business assistant.",
    "- NEVER use technical jargon. Do not mention 'databases', 'SQL', 'RLS', 'tools', 'queryDatabase', 'searchDocument', 'RAG', or 'chunks' to the user.",
    "- NEVER output raw UUIDs (e.g., 5e679cdc-...). Always refer to items by their Name, Title, or friendly descriptions.",
    "- If you cannot find data, say so naturally (e.g., 'I couldn't find any records of...') instead of mentioning tool failures.",
    "- Use markdown tables and bullet points to make data easy to read for managers.",
    "",

    // --- TOOL & DATA LOGIC ---
    "DOCUMENT QUESTIONS: When the user asks about the content of any file (PDF, log, image, transcript, attached document), you MUST call 'searchDocument' before answering. Pass the document's UUID as `documentId` and `sourceType: 'chat_attachment'` whenever the document was uploaded in this chat. Document IDs are listed in '[Attached documents]' and '[Documents available in this conversation]' blocks — these blocks REMAIN VALID across the entire conversation, not just the turn they appeared in. If the user says 'this document', 'that PDF', or 'the file I uploaded' on a follow-up turn, use the most recent document ID from those blocks.",
    "EMPTY RAG RESULTS: If 'searchDocument' returns 0 results for a targeted documentId, retry ONCE with a broader query (the document's main topic, or a few key keywords). Only after the retry returns 0 should you tell the user nothing relevant was found — and even then, summarize what you do know about the document from its filename.",
    "If the user asks about their tasks, submissions, team performance, or announcements, call 'queryDatabase' to look up the real data instead of guessing.",
    "CRITICAL TABLE MAPPINGS: 'Team' or 'Departments' -> 'teams', 'Validation Rules' -> 'validation_rules', 'Submission' -> 'submissions'.",
    "CRITICAL TOOL INSTRUCTION: Once you receive tool results, you MUST answer the user immediately in the next step. Do NOT loop or make multiple consecutive tool calls unless absolutely necessary.",
    "Prefer concrete answers over speculation. If a tool returns no rows, say so plainly without mentioning the tool itself.",
    "Never invent information or submission text. Always ground document answers in the snippets returned by 'searchDocument'.",
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
    "Be concise, format data in tables when useful, and refer to items by their titles and names rather than IDs.",
    "Never invent or fabricate data — only report what the tools return.",
    "",
    "DOCUMENT ANSWERS: When answering questions about a specific document, use ALL retrieved snippets — not just the top-scoring ones. Scan every snippet for the requested information before saying it's not available.",
    "",
    "LINKS: NEVER generate links to internal portal pages (e.g. /dashboard/..., /documents/...). These will 404. Instead, reference documents by their filename and friendly name so the user can find them in the portal. If you want to help the user locate something, describe where to find it in the portal navigation (e.g. 'Go to Dashboard > Materials').",
  ].join("\n")

  // --- Sliding window: trim old messages to save tokens on long chats ---
  //
  // IMPORTANT: feed the window the *flat* array we built above, NOT the
  // raw `body.messages`.
  //
  // The AI SDK's UIMessage stores text in `parts[]`, not on `.content`.
  // Reading `m.content` directly here returns `undefined`, gets coerced
  // to the string "undefined" via JSON.stringify, and the LLM ends up
  // receiving an empty user turn — which is exactly the
  // "It appears there was no content in your message" symptom.
  //
  // `flat` already contains: extracted text, injected attachment
  // metadata for the latest user turn, and only the user/assistant/system
  // roles. That's the canonical shape to send to the model.
  const trimmedMessages = applySlidingWindow(
    flat.map((m) => ({
      role: m.role,
      content: m.content,
      metadata: m.metadata,
    })) as SimpleMessage[],
    { maxTokens: 12_000, recentKeepCount: 6 },
  )

  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[smart-ai] LLM input: ${trimmedMessages.length} msgs, last user=${
        trimmedMessages[trimmedMessages.length - 1]?.content?.slice(0, 80) ?? "(empty)"
      }`,
    )
  }

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
      onFinish: async ({ text, totalUsage }) => {
        // ---- Persistence: save assistant reply ----
        if (text && threadPersisted) {
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
          // Determine if this user is unlimited (avoid stale closure reads)
          const isUnlimited = creditRow?.is_unlimited ?? (profile.role === "main_admin")

          // Atomic increment — avoids race conditions from concurrent requests
          // that would all read the same stale `used_this_period` from the closure.
          if (!isUnlimited) {
            const { error: incErr } = await persistClient.rpc("increment_ai_usage", {
              p_user_id: profile.id,
            })
            if (incErr) {
              // Fallback: direct update if RPC doesn't exist yet
              console.warn("[smart-ai] atomic increment RPC failed, using fallback:", incErr.message)
              await persistClient
                .from("ai_credit_limits")
                .update({
                  used_this_period: (creditRow?.used_this_period ?? 0) + 1,
                  updated_at: new Date().toISOString(),
                })
                .eq("user_id", profile.id)
            }
          }

          // Always log usage (even for unlimited users — for track record)
          // Use threadPersisted guard to avoid FK violation on thread_id
          const { error: logErr } = await persistClient.from("ai_usage_log").insert({
            user_id: profile.id,
            thread_id: threadPersisted ? threadId : null,
            model: SMART_AI_MODEL,
            tokens_in: totalUsage?.inputTokens ?? null,
            tokens_out: totalUsage?.outputTokens ?? null,
            period_type: creditRow?.period_type ?? "monthly",
          })

          if (logErr) {
            console.error("[smart-ai] usage log insert failed:", logErr.message)
          }

          // Trigger instant refresh of the dashboard
          const { revalidatePath } = await import("next/cache")
          revalidatePath("/dashboard/ai-usage")
          revalidatePath("/dashboard/admin/users")
          revalidatePath("/dashboard/activity")

          // Log to activity_log for the main dashboard audit trail
          await logActivity({
            actorId: profile.id,
            teamId: profile.team_id,
            action: "smart_ai.query",
            entityType: "chat_thread",
            entityId: threadId,
            metadata: {
              prompt: lastUserMsg.content.slice(0, 100) + (lastUserMsg.content.length > 100 ? "..." : ""),
              model: SMART_AI_MODEL,
              tokens_in: totalUsage?.inputTokens,
              tokens_out: totalUsage?.outputTokens,
            },
          })
        } catch (acctErr: any) {
          console.error("[smart-ai] credit accounting failed:", acctErr.message)
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
