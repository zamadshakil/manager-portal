import { NextResponse } from "next/server"
import { streamText, convertToModelMessages, stepCountIs, tool, type UIMessage } from "ai"
import { createOpenAI, openai } from "@ai-sdk/openai"
import { z } from "zod"
import { requireProfile } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { scopeForProfile } from "@/lib/smart-ai/client"
import { retrieveChunks } from "@/lib/smart-ai/retriever"
import {
  CAPABILITIES,
  aiAllowedRagSourceTypes,
  hasCapability,
} from "@/lib/permissions"
import { applySlidingWindow, type SimpleMessage } from "@/lib/smart-ai/sliding-window"
import { chatLimiter } from "@/lib/redis"
import { logActivity } from "@/lib/activity"
import { getCanonicalSiteUrl } from "@/lib/site-url"

// ---------------------------------------------------------------------------
// Resilience helpers
// ---------------------------------------------------------------------------

/**
 * Heuristic: is this error worth retrying once?
 * Catches the classes of failures we routinely see on the Railway-hosted
 * Supabase/Kong stack: 5xx upstream, fetch network blips, request timeouts,
 * and PostgREST schema-cache flutters.
 */
function isTransientError(err: unknown): boolean {
  if (!err) return false
  const msg =
    (err as any)?.message?.toLowerCase?.() ??
    String(err).toLowerCase()
  if (!msg) return false
  return (
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("aborted") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang up") ||
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("504") ||
    msg.includes("upstream") ||
    msg.includes("schema cache")
  )
}

/**
 * Retry an async operation up to `attempts` times when the failure looks
 * transient. Adds linear backoff so we don't hammer a flaky upstream.
 * Permanent errors (4xx auth, validation, etc.) are re-thrown immediately
 * so we don't waste latency on something that will never succeed.
 */
async function withRetry<T>(
  label: string,
  attempts: number,
  fn: () => Promise<T>,
): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (i === attempts - 1 || !isTransientError(err)) throw err
      const delay = 200 * (i + 1)
      console.warn(
        `[smart-ai] ${label} attempt ${i + 1}/${attempts} failed (transient), retrying in ${delay}ms:`,
        (err as any)?.message ?? err,
      )
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw lastErr
}

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
const SMART_AI_MODEL = process.env.SMART_AI_MODEL ?? "anthropic/claude-sonnet-4-5"

function resolveModel() {
  if (OPENROUTER_API_KEY) {
    const openrouter = createOpenAI({
      apiKey: OPENROUTER_API_KEY,
      baseURL: OPENROUTER_BASE_URL,
      headers: {
        "HTTP-Referer": getCanonicalSiteUrl(),
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

  // Capability gate. Without `smart_ai.chat` the user cannot use Smart AI
  // at all. The main admin can revoke this per-user via an explicit deny
  // override even though the role default grants it.
  if (!(await hasCapability(profile, CAPABILITIES.SMART_AI_CHAT))) {
    return NextResponse.json(
      { error: "You do not have access to Smart AI." },
      { status: 403 },
    )
  }

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

  // ---- Near-limit proactive alert string (injected into system prompt) ----
  let nearLimitAlert: string | null = null
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
    const pct = limit > 0 ? (used / limit) * 100 : 0
    if (pct >= 90) {
      nearLimitAlert = `⚠️ PROACTIVE CREDIT ALERT: This user has consumed ${used} out of ${limit} AI credits (${Math.round(pct)}% used) for this ${creditRow.period_type ?? "monthly"} period. Their credits reset on ${creditRow.period_end ?? "period end"}. At the END of your next response, add a brief, friendly note (1 sentence) warning them they are near their limit and should contact their administrator if they need more. Keep the warning conversational and non-alarming.`
    }
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json(
      { error: "messages array required" },
      { status: 400 },
    )
  }

  const scope = scopeForProfile(profile)

  // Capability-aware RAG allowlist. We compute the set of RAG `source_type`
  // values the user is allowed to retrieve (read + ai_analyze) once per
  // request and forward it to every retrieveChunks() call. Unauthorised
  // chunks never enter the LLM context window, even if they would have
  // matched the embedding/BM25 query.
  const allowedSourceTypes = await aiAllowedRagSourceTypes(profile)

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
      .insert(msgPayload as any)

    if (msgErr) {
      console.error("[smart-ai] user message save failed:", msgErr.message, msgErr.code)
    }

    // Defensive: explicitly bump chat_threads.updated_at so the thread
    // bubbles to the top of the sidebar even if the
    // `chat_messages_bump_thread` trigger isn't deployed in this
    // environment. The trigger remains the canonical mechanism; this is
    // belt-and-suspenders for environments where the migration hasn't
    // run yet.
    if (threadPersisted) {
      const { error: bumpErr } = await persistClient
        .from("chat_threads")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", threadId)
      if (bumpErr) {
        console.warn("[smart-ai] thread updated_at bump failed (non-fatal):", bumpErr.message)
      }
    }
  }


  // ---------------------------------------------------------------------
  // Authoritative schema map for the queryDatabase tool.
  //
  // The model sees these column lists in the system prompt AND every
  // queryDatabase call validates against them in code. This is the single
  // most important reliability win — previously the prompt told the model
  // about columns that didn't exist (e.g. validation_rules.name when the
  // real column is rule_name; announcements.content when it's body;
  // activity_log.target_type when it's entity_type), so most "complex
  // multi-table" questions failed with PostgREST schema errors and the
  // model gave up. With this map:
  //
  //   1. Unknown columns in `select` are silently dropped (warning surfaced
  //      to the model, not an error) and we fall back to `select=*` if
  //      everything was unknown. The query never fails for that reason.
  //
  //   2. Unknown columns in `filters` are dropped with a warning. The query
  //      still runs, the model learns the right column for the next turn.
  //
  //   3. If PostgREST still rejects the request despite our pre-flight
  //      validation (e.g. someone sneaks an aggregate through), we
  //      automatically retry once with `select=*` and no filters as a
  //      last-resort fallback. The model gets data instead of an error.
  // ---------------------------------------------------------------------
  interface TableSchema {
    columns: string[]
    description: string
    /** Default order column when the model omits `order`. */
    defaultOrder?: string
  }

  const TABLE_SCHEMAS: Record<string, TableSchema> = {
    submissions: {
      columns: [
        "id", "uploader_id", "team_id", "title", "blob_url", "blob_pathname",
        "mime_type", "size_bytes", "status", "score", "summary", "extracted_text",
        "flags", "metadata", "task_id", "task_assignment_id", "late_reason",
        "submitted_at", "is_late", "created_at", "updated_at",
      ],
      defaultOrder: "created_at",
      description:
        "Files/work submitted by users with validation status and AI score. " +
        "status enum: queued, parsing, validating, passed, failed, needs_review, late_submitted, missed.",
    },
    tasks: {
      columns: [
        "id", "team_id", "manager_id", "title", "description", "instructions",
        "due_at", "allow_late", "require_late_reason", "created_at", "updated_at",
      ],
      defaultOrder: "created_at",
      description:
        "Manager-created tasks assigned to team members. " +
        "IMPORTANT: due-date column is 'due_at' (NOT 'due_date').",
    },
    task_assignments: {
      columns: [
        "id", "task_id", "assignee_id", "status", "submission_id",
        "late_reason", "submitted_at", "created_at", "updated_at",
      ],
      defaultOrder: "created_at",
      description:
        "Per-user task assignments. " +
        "status enum: assigned, submitted, late_submitted, missed.",
    },
    profiles: {
      columns: [
        "id", "email", "full_name", "role", "team_id", "manager_id",
        "must_reset", "avatar_url", "created_at", "updated_at",
      ],
      defaultOrder: "full_name",
      description:
        "User profiles. role enum: main_admin, manager, member.",
    },
    validation_rules: {
      columns: [
        "id", "team_id", "rule_name", "description", "prompt_template",
        "threshold", "weight", "enabled", "created_by", "created_at", "updated_at",
      ],
      defaultOrder: "rule_name",
      description:
        "Per-team validation rules. " +
        "IMPORTANT: name column is 'rule_name' (NOT 'name'); prompt column is 'prompt_template' (NOT 'prompt').",
    },
    validation_runs: {
      columns: [
        "id", "submission_id", "rule_id", "model", "prompt_version", "raw_output",
        "pass", "score", "reasons", "flags", "latency_ms", "tokens_in",
        "tokens_out", "created_at",
      ],
      defaultOrder: "created_at",
      description:
        "AI validation results, one row per submission per rule. " +
        "'pass' is a boolean; 'reasons' and 'flags' are JSON arrays.",
    },
    announcements: {
      columns: [
        "id", "author_id", "team_id", "title", "body", "priority",
        "expires_at", "created_at",
      ],
      defaultOrder: "created_at",
      description:
        "Manager and admin announcements. " +
        "IMPORTANT: text body is 'body' (NOT 'content'). " +
        "priority enum: low, normal, high, urgent.",
    },
    materials: {
      columns: [
        "id", "author_id", "team_id", "title", "description", "blob_url",
        "blob_pathname", "file_type", "size_bytes", "tags", "created_at",
      ],
      defaultOrder: "created_at",
      description:
        "Reference files uploaded by managers/admins for team learning.",
    },
    teams: {
      columns: [
        "id", "name", "description", "manager_id", "settings",
        "created_at", "updated_at",
      ],
      defaultOrder: "name",
      description: "Teams in the organization.",
    },
    activity_log: {
      columns: [
        "id", "actor_id", "team_id", "action", "entity_type", "entity_id",
        "metadata", "ip_address", "user_agent", "created_at",
      ],
      defaultOrder: "created_at",
      description:
        "Append-only audit log. " +
        "IMPORTANT: target columns are 'entity_type'/'entity_id' (NOT 'target_type'/'target_id').",
    },
    report_snapshots: {
      columns: ["id", "team_id", "period", "period_start", "metrics", "created_at"],
      defaultOrder: "period_start",
      description:
        "Precomputed report metrics per team and period. " +
        "period enum: day, month, year.",
    },
    chat_documents: {
      columns: [
        "id", "user_id", "thread_id", "file_name", "file_url", "file_type",
        "rag_status", "text_excerpt", "indexed_at", "created_at",
      ],
      defaultOrder: "created_at",
      description: "Documents uploaded inside Smart AI chat threads.",
    },
  }
  const ALLOWED_TABLES = Object.keys(TABLE_SCHEMAS)

  // PostgREST does not support SQL aggregate functions in `select`. Detect
  // them so we can quietly rewrite the query instead of failing.
  const AGGREGATE_PATTERN = /\b(count|avg|sum|min|max|stddev|variance|distinct|coalesce|nullif)\s*\(/i

  // Levenshtein-ish closest-match for table-name typos.
  function suggestTable(input: string): string | null {
    const lc = input.toLowerCase()
    for (const t of ALLOWED_TABLES) {
      if (t.includes(lc) || lc.includes(t)) return t
    }
    return null
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, any> = {
    queryDatabase: tool({
      description:
        "Read rows from a permitted database table. RLS automatically restricts results " +
        "to what the current user is allowed to see. " +
        `Permitted tables: ${ALLOWED_TABLES.join(", ")}. ` +
        "CRITICAL: never use SQL aggregate functions (avg, sum, count, max, min) in 'select' — " +
        "they are not supported. Fetch raw rows (limit ≤100) and aggregate in your reasoning. " +
        "Use the 'filters' array for all WHERE clauses; supports operators eq, neq, gt, gte, lt, lte, like, ilike, in, is.",
      inputSchema: z.object({
        table: z.string().describe(`Table name. Must be one of: ${ALLOWED_TABLES.join(", ")}.`),
        select: z
          .string()
          .default("*")
          .describe("Comma-separated columns. Default '*' (recommended unless you need a tight subset)."),
        filters: z
          .array(
            z.object({
              column: z.string(),
              op: z.enum([
                "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is",
              ]),
              value: z.union([z.string(), z.number(), z.boolean()]),
            }),
          )
          .optional()
          .describe(
            "WHERE clauses combined with AND. " +
              "For 'in', value is comma-separated (e.g. 'queued,passed'). " +
              "For 'is', value is 'null' or 'not.null'. " +
              "For dates use ISO 8601 strings with gte/lte.",
          ),
        eq: z
          .array(
            z.object({
              column: z.string(),
              value: z.union([z.string(), z.number(), z.boolean()]),
            }),
          )
          .optional()
          .describe("DEPRECATED — prefer 'filters' with op:'eq'. Kept for backward compatibility."),
        order: z
          .object({
            column: z.string(),
            ascending: z.boolean().default(false),
          })
          .optional()
          .describe("Optional ORDER BY. Defaults to the table's natural recency column."),
        limit: z.number().int().min(1).max(100).default(20),
      }),
      execute: async ({ table, select, filters, eq, order, limit }) => {
        // 1) Table existence check with fuzzy suggestion.
        const schema = TABLE_SCHEMAS[table]
        if (!schema) {
          const suggestion = suggestTable(table)
          return {
            error:
              `Table "${table}" is not queryable.` +
              (suggestion ? ` Did you mean "${suggestion}"?` : "") +
              ` Permitted: ${ALLOWED_TABLES.join(", ")}.`,
            retryable: false,
          }
        }

        const warnings: string[] = []
        const validColumns = new Set(schema.columns)

        // 2) Merge legacy `eq` into the unified `filters` shape.
        const requestedFilters = [
          ...(filters ?? []),
          ...(eq ?? []).map((f) => ({ column: f.column, op: "eq" as const, value: f.value })),
        ]

        // 3) Sanitize `select`. PostgREST rejects aggregates and unknown columns.
        let cleanSelect = (select ?? "*").trim() || "*"
        if (AGGREGATE_PATTERN.test(cleanSelect)) {
          warnings.push(
            "Stripped SQL aggregate from select — PostgREST does not support aggregates. " +
              "Fetched raw rows; compute aggregates in your reasoning.",
          )
          cleanSelect = "*"
        }
        if (cleanSelect !== "*") {
          const requested = cleanSelect.split(",").map((s) => s.trim()).filter(Boolean)
          const valid = requested.filter((c) => validColumns.has(c))
          if (valid.length === 0) {
            warnings.push(
              `Dropped unknown columns from select: ${requested.join(", ")}. ` +
                `Falling back to *. Available columns: ${schema.columns.join(", ")}.`,
            )
            cleanSelect = "*"
          } else if (valid.length < requested.length) {
            const dropped = requested.filter((c) => !validColumns.has(c))
            warnings.push(
              `Dropped unknown columns from select: ${dropped.join(", ")}. ` +
                `Available: ${schema.columns.join(", ")}.`,
            )
            cleanSelect = valid.join(",")
          }
        }

        // 4) Validate filter columns. Unknowns become warnings, not errors.
        const validFilters = requestedFilters.filter((f) => {
          if (validColumns.has(f.column)) return true
          warnings.push(
            `Dropped filter on unknown column "${f.column}" of ${table}. ` +
              `Available: ${schema.columns.join(", ")}.`,
          )
          return false
        })

        // 5) Run the query. Wrapped so withRetry can handle transient blips.
        const runQuery = async (
          selectArg: string,
          filtersArg: typeof validFilters,
          applyOrder: boolean,
        ) => {
          let builder: any = supabase.from(table as any).select(selectArg)
          for (const f of filtersArg) {
            const v = f.value
            switch (f.op) {
              case "eq": builder = builder.eq(f.column, v as any); break
              case "neq": builder = builder.neq(f.column, v as any); break
              case "gt": builder = builder.gt(f.column, v as any); break
              case "gte": builder = builder.gte(f.column, v as any); break
              case "lt": builder = builder.lt(f.column, v as any); break
              case "lte": builder = builder.lte(f.column, v as any); break
              case "like": builder = builder.like(f.column, String(v)); break
              case "ilike": builder = builder.ilike(f.column, String(v)); break
              case "in": {
                const list = String(v).split(",").map((s) => s.trim()).filter(Boolean)
                if (list.length > 0) builder = builder.in(f.column, list as any)
                break
              }
              case "is": {
                const norm = String(v).toLowerCase().replace(/^is\s+/, "")
                if (norm === "null" || norm === "not null" || norm === "not.null") {
                  builder = builder.is(f.column, norm.includes("not") ? ("not.null" as any) : null)
                }
                break
              }
            }
          }
          if (applyOrder) {
            const orderCol =
              order && validColumns.has(order.column) ? order.column : schema.defaultOrder
            if (orderCol) {
              builder = builder.order(orderCol, { ascending: order?.ascending ?? false })
            }
          }
          const result = await builder.limit(limit)
          if (result.error) {
            const e: any = new Error(result.error.message ?? "query failed")
            e.code = result.error.code
            e.details = result.error.details
            throw e
          }
          return result.data
        }

        try {
          const data = await withRetry(`queryDatabase(${table})`, 2, () =>
            runQuery(cleanSelect, validFilters, true),
          )
          return {
            data: data ?? [],
            count: Array.isArray(data) ? data.length : 0,
            ...(warnings.length > 0 ? { warnings } : {}),
          }
        } catch (err: any) {
          const code = err?.code as string | undefined
          const msg = err?.message ?? String(err)
          console.error(`[smart-ai] queryDatabase(${table}) failed:`, msg, code ?? "")

          // Auth / session expiry — user needs to re-login.
          if (msg.includes("JWT") || msg.includes("expired") || msg.includes("token")) {
            return {
              error:
                "Authentication error: your session expired. Tell the user to refresh the page to sign in again.",
              retryable: false,
            }
          }

          // Schema mismatch — last-resort fallback: drop everything and try
          // a plain SELECT * with no filters. Better to give the model
          // *some* data it can summarize than to leave it empty-handed.
          if (
            code === "PGRST204" ||
            code === "PGRST205" ||
            code === "42703" || // undefined_column
            code === "42P01" || // undefined_table
            msg.includes("column") ||
            msg.includes("relation") ||
            msg.includes("does not exist") ||
            msg.includes("schema cache")
          ) {
            try {
              const fallback = await runQuery("*", [], true)
              return {
                data: fallback ?? [],
                count: Array.isArray(fallback) ? fallback.length : 0,
                warnings: [
                  ...warnings,
                  `Original query failed (${msg}). Returned a plain "${table}" listing instead — re-filter in your reasoning.`,
                ],
              }
            } catch {
              return {
                error:
                  `Schema mismatch on ${table}: ${msg}. ` +
                  `Available columns: ${schema.columns.join(", ")}.`,
                retryable: false,
              }
            }
          }

          // Permission denied — RLS blocked it.
          if (
            code === "42501" ||
            msg.includes("permission denied") ||
            msg.includes("not authorized")
          ) {
            return {
              error: `Permission denied for ${table}. The current user's role cannot read this data.`,
              retryable: false,
            }
          }

          // Transient upstream — already retried inside withRetry.
          return {
            error: `Database temporarily unavailable: ${msg}`,
            retryable: true,
          }
        }
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
        // Use higher topK for targeted doc searches to get full context.
        const effectiveTopK = documentId ? 20 : 12
        try {
          const chunks = await withRetry("searchDocument", 2, () =>
            retrieveChunks({
              scope,
              query,
              documentId: documentId ?? null,
              sourceType: sourceType ?? null,
              topK: effectiveTopK,
              allowedSourceTypes,
            }),
          )
          return { results: chunks, count: chunks.length }
        } catch (err: any) {
          const msg = err?.message ?? String(err)
          console.error("[smart-ai] searchDocument error:", msg)
          // CRITICAL: surface a structured error so the model can tell the
          // user "the document store is temporarily unavailable" instead
          // of "I couldn't find anything". The previous code returned
          // empty results, which the model treated as a successful "no
          // matches" answer — exactly the failure mode the user reported.
          return {
            results: [],
            count: 0,
            error: `Document search temporarily unavailable: ${msg}. Tell the user retrieval failed and they can retry — do NOT claim the document has no relevant content.`,
            retryable: isTransientError(err),
          }
        }
      },
    }),

    // ---- Credit Intelligence Tools ----------------------------------------

    getMyCredits: tool({
      description:
        "Retrieve AI credit usage and quota for the current user. " +
        "Use this when the user asks about their credits, limits, remaining messages, " +
        "quota, or how many AI uses they have left. " +
        "For main_admin: use scope='global' to get a department-level breakdown.",
      inputSchema: z.object({
        scope: z
          .enum(["self", "global"])
          .default("self")
          .describe(
            "'self' for the current user's own quota. " +
            "'global' for a platform-wide department breakdown (main_admin only).",
          ),
      }),
      execute: async ({ scope }) => {
        try {
          if (scope === "global") {
            if (profile.role !== "main_admin") {
              return {
                error: "Access denied. Only the Main Admin can view global credit summaries.",
                retryable: false,
              }
            }
            const { data, error } = await persistClient.rpc("get_department_credit_summary")
            if (error) {
              console.error("[smart-ai] get_department_credit_summary failed:", error.message)
              return { error: `Could not fetch department summary: ${error.message}`, retryable: true }
            }
            return {
              scope: "global",
              departments: (data ?? []).map((row: any) => ({
                team: row.team_name,
                total_credits_used: row.total_credits_used,
                active_users: row.active_users,
                avg_per_user: row.avg_credits_per_user,
                near_limit_users: row.near_limit_users,
              })),
            }
          }

          // scope === 'self': use RLS-scoped client so user sees only their row
          const { data, error } = await supabase
            .from("ai_credit_limits")
            .select("monthly_limit, used_this_period, period_type, period_start, period_end, is_unlimited")
            .eq("user_id", profile.id)
            .maybeSingle()

          if (error) {
            return { error: `Could not fetch credit data: ${error.message}`, retryable: true }
          }

          if (!data) {
            // No row yet — default limits apply
            return {
              scope: "self",
              used: 0,
              limit: 100,
              remaining: 100,
              usage_pct: 0,
              period_type: "monthly",
              period_end: null,
              is_unlimited: profile.role === "main_admin",
              is_near_limit: false,
            }
          }

          const row = data as any
          const used = row.used_this_period ?? 0
          const limit = row.monthly_limit ?? 100
          const isUnlimited = row.is_unlimited ?? false
          const remaining = isUnlimited ? null : Math.max(0, limit - used)
          const usagePct = isUnlimited || limit === 0 ? 0 : Math.round((used / limit) * 100)

          return {
            scope: "self",
            used,
            limit,
            remaining,
            usage_pct: usagePct,
            period_type: row.period_type,
            period_start: row.period_start,
            period_end: row.period_end,
            is_unlimited: isUnlimited,
            is_near_limit: !isUnlimited && usagePct >= 90,
          }
        } catch (err: any) {
          console.error("[smart-ai] getMyCredits failed:", err?.message ?? err)
          return { error: `Credit lookup failed: ${err?.message ?? String(err)}`, retryable: true }
        }
      },
    }),

    getUsageLogs: tool({
      description:
        "Fetch recent AI credit consumption log entries. " +
        "Use this when the user asks what used their credits, why their credits went down, " +
        "or to explain recent deductions. Each entry shows the event type, credits deducted, " +
        "model used, and timestamp. Main admins can optionally fetch logs for any specific user.",
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(10)
          .describe("Number of log entries to return (max 20)."),
        targetUserId: z
          .string()
          .optional()
          .describe("Main admin only: fetch logs for a specific user by their UUID."),
      }),
      execute: async ({ limit, targetUserId }) => {
        try {
          // RBAC: only main_admin can query other users' logs
          if (targetUserId && profile.role !== "main_admin") {
            return {
              error: "Access denied. Only the Main Admin can view other users' usage logs.",
              retryable: false,
            }
          }

          const resolvedUserId = targetUserId ?? profile.id
          // Use admin client when fetching for a different user (bypasses RLS),
          // otherwise use RLS-scoped client (user sees only their own rows)
          const client = targetUserId ? persistClient : supabase

          const { data, error } = await client
            .from("ai_usage_log")
            .select("id, created_at, event_type, credits_deducted, model, thread_id, period_type")
            .eq("user_id", resolvedUserId)
            .order("created_at", { ascending: false })
            .limit(limit)

          if (error) {
            console.error("[smart-ai] getUsageLogs failed:", error.message)
            return { error: `Could not fetch usage logs: ${error.message}`, retryable: true }
          }

          const logs = (data ?? []) as any[]

          // Humanise the log entries — resolve thread titles where available
          let threadTitleMap: Record<string, string> = {}
          const threadIds = [...new Set(logs.map((l) => l.thread_id).filter(Boolean))]
          if (threadIds.length > 0) {
            const { data: threads } = await persistClient
              .from("chat_threads")
              .select("id, title")
              .in("id", threadIds)
            if (threads) {
              for (const t of threads as any[]) {
                threadTitleMap[t.id] = t.title ?? "Untitled conversation"
              }
            }
          }

          return {
            logs: logs.map((l) => ({
              timestamp: l.created_at,
              event: l.event_type ?? "smart_ai_query",
              credits_deducted: l.credits_deducted ?? 1,
              model: l.model,
              period_type: l.period_type,
              conversation: l.thread_id ? (threadTitleMap[l.thread_id] ?? "Untitled conversation") : null,
            })),
            count: logs.length,
          }
        } catch (err: any) {
          console.error("[smart-ai] getUsageLogs failed:", err?.message ?? err)
          return { error: `Usage log lookup failed: ${err?.message ?? String(err)}`, retryable: true }
        }
      },
    }),

    getTopCreditConsumers: tool({
      description:
        "Main admin only: List the top N users by AI credit consumption for the current period. " +
        "Use this when the admin asks 'who uses the most credits', 'top consumers', or " +
        "'who is consuming the most AI credits this month/week'.",
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(3)
          .describe("Number of top consumers to return (default 3)."),
      }),
      execute: async ({ limit }) => {
        if (profile.role !== "main_admin") {
          return {
            error: "Access denied. Only the Main Admin can view top consumer rankings.",
            retryable: false,
          }
        }
        try {
          const { data, error } = await persistClient.rpc("get_top_credit_consumers", {
            p_limit: limit,
          })
          if (error) {
            console.error("[smart-ai] get_top_credit_consumers failed:", error.message)
            return { error: `Could not fetch top consumers: ${error.message}`, retryable: true }
          }
          return {
            consumers: (data ?? []).map((row: any) => ({
              name: row.full_name ?? row.email ?? "Unknown",
              email: row.email,
              role: row.role,
              team: row.team_name ?? "No team",
              used: row.used_this_period,
              limit: row.monthly_limit,
              is_unlimited: row.is_unlimited,
              usage_pct: row.usage_pct,
              period_type: row.period_type,
              resets_on: row.period_end,
            })),
            count: (data ?? []).length,
          }
        } catch (err: any) {
          console.error("[smart-ai] getTopCreditConsumers failed:", err?.message ?? err)
          return { error: `Top consumers lookup failed: ${err?.message ?? String(err)}`, retryable: true }
        }
      },
    }),
  }

  // -----------------------------------------------------------------
  // Build the system prompt.
  //
  // Three big improvements over the previous version:
  //
  //  (a) Real schema. The column lists below are generated from
  //      TABLE_SCHEMAS so they're guaranteed to match the database. The
  //      previous prompt hard-coded WRONG names ('name' vs 'rule_name',
  //      'content' vs 'body', 'target_type' vs 'entity_type', 'due_date'
  //      vs 'due_at') which is why most multi-table questions failed —
  //      the model called PostgREST with columns that don't exist.
  //
  //  (b) Identity & date context. The model knows who the user is and
  //      what "this month" / "last 30 days" / "last month" mean, in ISO
  //      8601, so it can build correct gte/lte filters in one shot.
  //
  //  (c) Aggregation strategy. Explicit rule that aggregates run in the
  //      model's reasoning, never in SQL — this is the failure mode in
  //      the "team performance recap" screenshot, where the model tried
  //      avg()/count() in select and got nothing back.
  // -----------------------------------------------------------------
  const now = new Date()
  const todayIso = now.toISOString()
  const dayMs = 24 * 60 * 60 * 1000
  const last7Iso = new Date(now.getTime() - 7 * dayMs).toISOString()
  const last30Iso = new Date(now.getTime() - 30 * dayMs).toISOString()
  const startOfMonthIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const startOfLastMonthIso = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()
  const endOfLastMonthIso = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999).toISOString()

  const schemaSection = Object.entries(TABLE_SCHEMAS)
    .map(
      ([name, s]) =>
        `### ${name}\n  columns: ${s.columns.join(", ")}\n  ${s.description}`,
    )
    .join("\n\n")

  const systemPrompt = [
    "You are Smart AI, the agentic data assistant inside the Hierarchia manager portal.",
    "Your job is to answer manager and member questions accurately by querying the live database and any uploaded documents — never by guessing.",
    "",
    "## CURRENT USER",
    `- user_id: ${profile.id}`,
    `- name: ${profile.full_name ?? profile.email}`,
    `- role: ${profile.role}`,
    `- team_id: ${profile.team_id ?? "(not assigned to a team)"}`,
    "",
    "## CURRENT DATE (ISO 8601, UTC) — use these directly in gte/lte filters",
    `- now: ${todayIso}`,
    `- last 7 days starts: ${last7Iso}`,
    `- last 30 days starts: ${last30Iso}`,
    `- this month starts: ${startOfMonthIso}`,
    `- last month range: ${startOfLastMonthIso} to ${endOfLastMonthIso}`,
    "",
    "## COMMUNICATION STYLE",
    "- Polished, concise, professional. NEVER mention 'database', 'SQL', 'tool', 'query', 'RAG', 'chunk', 'PostgREST', or technical errors to the user.",
    "- NEVER print raw UUIDs. Always reference items by title or name.",
    "- Use markdown tables, bullet lists, and **bold** for readability.",
    "- If data is missing, say it naturally: \"I couldn't find any submissions for that period.\" Do not blame tools or systems.",
    "",
    "## TABLE SCHEMA — column names are EXACT, do not guess",
    schemaSection,
    "",
    "## QUERY STRATEGY (read carefully)",
    "1. ALWAYS prefer the `filters` array over the legacy `eq` field. Operators: eq, neq, gt, gte, lt, lte, like, ilike, in, is.",
    "2. Date ranges → use `gte` / `lte` with the ISO 8601 constants from the CURRENT DATE block above.",
    "3. NEVER use SQL aggregate functions (avg, count, sum, min, max, distinct) inside `select` — they are not supported and the call will silently lose precision. Instead: fetch raw rows (limit ≤ 100) and compute averages, counts, ratios, trends in your own reasoning.",
    "4. Identity-based filters:",
    "   - 'my tasks' / 'tasks assigned to me' → query `task_assignments` with filter `{column: 'assignee_id', op: 'eq', value: <user_id>}`.",
    "   - 'my submissions' → query `submissions` with `{column: 'uploader_id', op: 'eq', value: <user_id>}`.",
    "   - 'my team' / 'our team' → use the user's `team_id` from the CURRENT USER block.",
    "5. Common multi-step recipes:",
    "   - **Failure rate per rule (last 30 days)**: 1) query `validation_runs` with `created_at >= last30`, select `rule_id, pass`, limit 100. 2) query `validation_rules` for `rule_name`. 3) Group by rule_id in your head, count pass=false / total per rule.",
    "   - **Team performance recap (this month)**: 1) query `submissions` filtered by `team_id` AND `created_at >= startOfMonth`, fetch `score, status, is_late, created_at`. 2) Optionally repeat for last month range. 3) Compute averages, pass rate, late count, and trend in your reasoning. Render as one tight paragraph.",
    "   - **Late submissions**: filter `submissions` with `{column: 'is_late', op: 'eq', value: true}`.",
    "   - **Top consumers / contributors**: fetch raw rows, group + sort + slice in reasoning.",
    "6. If a user asks about another team or user by NAME, query `teams` or `profiles` first to resolve the name → id, then use that id in subsequent filters.",
    "",
    "## TOOL CALL DISCIPLINE",
    "- You may make up to 10 tool calls per turn. Stop the moment you have enough data.",
    "- After each call inspect the response:",
    "  - `data` (or `results`): use it.",
    "  - `warnings`: read them — they tell you the exact column names you should have used. Adapt your next call accordingly. Warnings are NOT errors; the call still returned data.",
    "  - `error` with `retryable: true`: you MAY retry the same call once.",
    "  - `error` with `retryable: false`: do NOT retry the same call — change strategy (different table, different filter, broader date range).",
    "- If multiple calls fail but ANY call returned data, synthesize a partial answer from what you have. Be transparent about what is missing without blaming systems.",
    "- NEVER invent values, names, scores, or dates. If you genuinely cannot determine something, say \"I don't have that information right now.\"",
    "",
    "LINKS: NEVER generate links to internal portal pages (e.g. /dashboard/..., /documents/...). These will 404. Instead, reference documents by their filename and friendly name so the user can find them in the portal. If you want to help the user locate something, describe where to find it in the portal navigation (e.g. 'Go to Dashboard > Materials').",
    "",

    // --- CREDIT INTELLIGENCE ---
    "CREDIT & QUOTA INTELLIGENCE:",
    "- When the user asks about their credits, limits, remaining messages, quota, or AI usage, call 'getMyCredits' with scope='self'. DO NOT guess or use any credit data from the conversation context.",
    "- When the user asks what consumed their credits, why their count went down, or wants a usage history, call 'getUsageLogs'.",
    "- MAIN ADMIN ONLY: When asked 'which department uses the most credits?', 'global usage summary', or similar cross-department questions, call 'getMyCredits' with scope='global'.",
    "- MAIN ADMIN ONLY: When asked 'who are the top consumers?', 'list top 3 credit users', or 'who uses the most AI?', call 'getTopCreditConsumers'.",
    "- Report credits in a friendly, human format: e.g. 'You have 42 out of 100 credits remaining for this monthly period (58% used). Your credits reset on May 31.'.",
    "- If is_unlimited is true, say 'You have unlimited AI credits — no restrictions apply.'.",
    "- If is_near_limit is true in the result, proactively and gently note this in your response.",
    "- NEVER expose raw user UUIDs when discussing credit data. Always use full_name or email.",
    "- NEVER allow non-admin users to see other users' credit data. The tools enforce this — if a tool returns an 'Access denied' error, tell the user politely they cannot view that information.",
    "- Key credit tables (for reference only — use the dedicated tools, not queryDatabase, for credit data):",
    "  · ai_credit_limits: user_id, monthly_limit, used_this_period, period_type, period_start, period_end, is_unlimited",
    "  · ai_usage_log: user_id, thread_id, model, event_type, credits_deducted, status, created_at",
    nearLimitAlert ?? "",
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
  // Sliding window: increased budget + recent-keep so we don't drop the
  // attached document IDs ("[Documents available in this conversation]")
  // partway through a long thread. With heavy tool-result turns, 6 was
  // collapsing context too aggressively.
  const trimmedMessages = applySlidingWindow(
    flat.map((m) => ({
      role: m.role,
      content: m.content,
      metadata: m.metadata,
    })) as SimpleMessage[],
    { maxTokens: 16_000, recentKeepCount: 10 },
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

  // Compose an abort signal that fires on either client disconnect or our
  // own hard timeout — prevents the route from hanging forever when the
  // upstream model call stalls.
  const requestSignal: AbortSignal | undefined = (req as any).signal
  const timeoutSignal = AbortSignal.timeout(120_000) // 2 min hard cap
  const abortSignal: AbortSignal = requestSignal
    ? AbortSignal.any([requestSignal, timeoutSignal])
    : timeoutSignal

  try {
    const result = streamText({
      model: resolveModel(),
      system: systemPrompt,
      messages: await convertToModelMessages(trimmedUIMessages as any),
      tools,
      // Bumped from 5 → 10. Complex multi-table queries (e.g. "compare
      // pass rates across teams + show top failing rules") plan 6–8 tool
      // calls before synthesizing the answer; the previous cap silently
      // truncated the agent mid-plan and the user saw a half-baked reply
      // (or nothing at all).
      stopWhen: stepCountIs(10),
      abortSignal,
      // Surface mid-stream errors instead of letting the SSE close with
      // zero chunks. Without this, model API 5xx / rate-limit / malformed
      // tool-call errors disappear into the void and the chat UI sits
      // forever at "Thinking…" — which is exactly the breakage reported.
      onError: ({ error }) => {
        const msg = (error as any)?.message ?? String(error)
        console.error("[smart-ai] streamText runtime error:", msg, error)
      },
      onFinish: async ({ text, totalUsage }) => {
        // ---- 1. Persist assistant reply + bump thread timestamp ----
        try {
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

            // Single combined update: bump updated_at always, plus title
            // for brand-new threads. Doing both in one query saves a
            // round-trip on the hot path.
            const updates: Record<string, string> = {
              updated_at: new Date().toISOString(),
            }
            if (isNewThread && threadTitle !== "New conversation") {
              updates.title = threadTitle
            }
            await persistClient
              .from("chat_threads")
              .update(updates as any)
              .eq("id", threadId)
          }
        } catch (persistErr: any) {
          console.error("[smart-ai] persistence step failed:", persistErr?.message ?? persistErr)
        }

        // ---- 2. Credit increment ----
        try {
          // Determine if this user is unlimited (avoid stale closure reads)
          const isUnlimited = creditRow?.is_unlimited ?? (profile.role === "main_admin")

          // Atomic increment — avoids race conditions from concurrent requests
          // that would all read the same stale `used_this_period` from the closure.
          // We increment usage for EVERYONE, including unlimited admins, so we have
          // accurate system-wide usage metrics and top consumer track records.
          // Atomic increment + logging — avoids race conditions from concurrent requests.
          // We increment usage for EVERYONE, including unlimited admins, so we have
          // accurate system-wide usage metrics and top consumer track records.
          const { error: incErr } = await persistClient.rpc("increment_ai_usage", {
            p_user_id: profile.id,
            p_credits: 1,
            p_event_type: "smart_ai_query",
            p_model: SMART_AI_MODEL,
            p_thread_id: threadPersisted ? threadId : null,
          })
          
          if (incErr) {
            console.error("[smart-ai] credit accounting failed:", incErr.message)
          }
        } catch (logErr: any) {
          console.error("[smart-ai] usage log step failed:", logErr?.message ?? logErr)
        }

        // ---- 4. Revalidate dashboards (best-effort) ----
        try {
          const { revalidatePath } = await import("next/cache")
          revalidatePath("/dashboard/ai-usage")
          revalidatePath("/dashboard/admin/users")
          revalidatePath("/dashboard/activity")
        } catch (revalErr: any) {
          console.warn("[smart-ai] revalidate failed (non-fatal):", revalErr?.message ?? revalErr)
        }

        // ---- 5. Activity log (defensive: lastUserMsg may be undefined) ----
        try {
          const promptPreview = lastUserMsg?.content
            ? lastUserMsg.content.slice(0, 100) +
              (lastUserMsg.content.length > 100 ? "..." : "")
            : ""
          await logActivity({
            actorId: profile.id,
            teamId: profile.team_id,
            action: "smart_ai.query",
            entityType: "chat_thread",
            entityId: threadId,
            metadata: {
              prompt: promptPreview,
              model: SMART_AI_MODEL,
              tokens_in: totalUsage?.inputTokens,
              tokens_out: totalUsage?.outputTokens,
            },
          })
        } catch (activityErr: any) {
          console.warn(
            "[smart-ai] activity log failed (non-fatal):",
            activityErr?.message ?? activityErr,
          )
        }
      },
    })

    // CRITICAL: route stream-time errors back to the client so the chat
    // UI can render a useful message instead of just hanging. Without
    // `onError` here, the AI SDK closes the SSE on error and `useChat`
    // sees a successful-but-empty stream — exactly the "no chunk output"
    // failure mode the user reported.
    const res = result.toUIMessageStreamResponse({
      onError: (error) => {
        // H-9: Always log the full error server-side, but never forward
        // raw provider / DB error text to the browser. Provider errors can
        // contain API key fragments, model IDs, internal hostnames, and
        // PostgREST schema hints — all of which help an attacker map the
        // backend. The user only needs a generic, safe message.
        const rawMsg =
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : ""
        console.error("[smart-ai] stream emit error:", rawMsg || error)
        return "An unexpected error occurred while generating a response. Please try again."
      },
    })
    res.headers.set("x-smart-ai-source", "native")
    return res
  } catch (fallbackError: any) {
    // This catches ONLY synchronous setup errors (bad model id, missing
    // API key surfaced before the first chunk, etc.). Stream-time errors
    // are handled by the `onError` callbacks above.
    // H-9: Log the underlying error but return a generic message to the
    // client so provider/model identifiers and stack details don't leak.
    const msg = fallbackError?.message ?? String(fallbackError)
    console.error("[smart-ai] streamText setup failed:", msg)
    return NextResponse.json(
      {
        error:
          "Smart AI is currently unavailable. Please try again later or contact your administrator if this persists.",
      },
      { status: 503 },
    )
  }
}
