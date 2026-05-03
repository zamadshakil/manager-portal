import { createClient } from "@supabase/supabase-js"
import { tool } from "ai"
import { z } from "zod"

/**
 * Database tools exposed to the LLM.
 *
 * The agent uses these to look up real portal data (tasks, submissions,
 * announcements, ...). Every call goes through Supabase with the user's
 * JWT, so Row Level Security is the *primary* authorization boundary —
 * but we ALSO maintain an in-process allow-list of tables and writes the
 * AI is permitted to touch. Defense in depth: a buggy or jailbroken model
 * still can't ask to drop tables or read tables outside the chat surface.
 *
 * Important: this file uses AI SDK v6 syntax (`inputSchema`, not
 * `parameters`). With v4 syntax, `streamText` silently registers the tool
 * with no schema and the model sees no tools at all.
 */

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    "[mcp] Warning: SUPABASE_URL or SUPABASE_ANON_KEY is missing. Database tools will fail.",
  )
}

// Tables the model is allowed to *read*. Add cautiously — every entry here
// becomes part of the LLM's reachable surface.
const READABLE_TABLES = new Set([
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
])

// Tables the model is allowed to *modify*. Strictly smaller than reads.
// Adding here without RLS coverage on the table is a real footgun.
const WRITABLE_TABLES = new Set(["tasks", "announcements"])

type Role = "main_admin" | "manager" | "member"

export interface ToolContext {
  accessToken: string | null
  role: Role
}

export function createSupabaseTools(ctx: ToolContext) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: ctx.accessToken
        ? { Authorization: `Bearer ${ctx.accessToken}` }
        : {},
    },
  })

  const canWrite = ctx.role === "main_admin" || ctx.role === "manager"

  return {
    queryDatabase: tool({
      description:
        "Read rows from a permitted database table. RLS automatically restricts results to what the current user is allowed to see. " +
        `Permitted tables: ${[...READABLE_TABLES].join(", ")}.`,
      inputSchema: z.object({
        table: z
          .string()
          .describe("Table name to query, e.g. 'tasks', 'submissions', 'announcements'."),
        select: z
          .string()
          .default("*")
          .describe("Comma-separated columns to select. Use '*' for all."),
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
        if (!READABLE_TABLES.has(table)) {
          return {
            error: `Table '${table}' is not in the read allow-list. Permitted: ${[...READABLE_TABLES].join(", ")}.`,
          }
        }
        let builder: any = supabase.from(table).select(select)
        if (eq) {
          for (const f of eq) builder = builder.eq(f.column, f.value as any)
        }
        if (order) {
          builder = builder.order(order.column, { ascending: order.ascending })
        }
        const { data, error } = await builder.limit(limit)
        if (error) {
          console.error(`[mcp] queryDatabase(${table}) error: ${error.message}`)
          return { error: error.message }
        }
        return { data, count: Array.isArray(data) ? data.length : 0 }
      },
    }),

    insertRecord: tool({
      description:
        "Insert a new row into a writable table. Use sparingly — confirm with the user first when destructive. " +
        `Permitted tables: ${[...WRITABLE_TABLES].join(", ")}.`,
      inputSchema: z.object({
        table: z.string(),
        record: z
          .record(z.string(), z.any())
          .describe("Object representing the row to insert."),
      }),
      execute: async ({ table, record }) => {
        if (!canWrite) {
          return { error: `Role '${ctx.role}' is not permitted to insert records.` }
        }
        if (!WRITABLE_TABLES.has(table)) {
          return {
            error: `Table '${table}' is not in the write allow-list. Permitted: ${[...WRITABLE_TABLES].join(", ")}.`,
          }
        }
        const { data, error } = await supabase.from(table).insert(record).select()
        if (error) {
          console.error(`[mcp] insertRecord(${table}) error: ${error.message}`)
          return { error: error.message }
        }
        return { success: true, data }
      },
    }),

    updateRecord: tool({
      description:
        "Update an existing row in a writable table by its UUID. RLS still applies. " +
        `Permitted tables: ${[...WRITABLE_TABLES].join(", ")}.`,
      inputSchema: z.object({
        table: z.string(),
        id: z.string().describe("UUID of the row to update."),
        updates: z
          .record(z.string(), z.any())
          .describe("Object of column → new value pairs."),
      }),
      execute: async ({ table, id, updates }) => {
        if (!canWrite) {
          return { error: `Role '${ctx.role}' is not permitted to update records.` }
        }
        if (!WRITABLE_TABLES.has(table)) {
          return {
            error: `Table '${table}' is not in the write allow-list. Permitted: ${[...WRITABLE_TABLES].join(", ")}.`,
          }
        }
        const { data, error } = await supabase
          .from(table)
          .update(updates)
          .eq("id", id)
          .select()
        if (error) {
          console.error(`[mcp] updateRecord(${table}) error: ${error.message}`)
          return { error: error.message }
        }
        return { success: true, data }
      },
    }),
  }
}
