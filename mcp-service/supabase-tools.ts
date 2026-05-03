import { createClient } from "@supabase/supabase-js"
import { tool } from "ai"
import { z } from "zod"

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn("[mcp] Warning: SUPABASE_URL or SUPABASE_ANON_KEY is missing. Database tools will fail.")
}

export function createSupabaseTools(accessToken: string | null) {
  // If the user isn't authenticated, we create an anonymous client (or we could just return empty tools)
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    },
  })

  return {
    queryDatabase: tool({
      description:
        "Execute a select query on the database. RLS policies will automatically restrict results to what the user is allowed to see. Example: table='tasks', select='id, title, status', eq=[{column: 'status', value: 'pending'}].",
      parameters: z.object({
        table: z.string().describe("The table name to query (e.g., 'tasks', 'submissions', 'announcements')"),
        select: z.string().describe("Columns to select, comma separated. Default: '*'").default("*"),
        eq: z.array(z.object({ column: z.string(), value: z.string() })).describe("Optional equality filters").optional(),
        limit: z.number().describe("Max rows to return").default(10),
      }),
      execute: async ({ table, select, eq, limit }) => {
        let builder: any = supabase.from(table).select(select)
        if (eq) {
          for (const filter of eq) {
            builder = builder.eq(filter.column, filter.value)
          }
        }
        const { data, error } = await builder.limit(limit)
        if (error) {
          console.error(`[mcp] queryDatabase error: ${error.message}`)
          return { error: error.message }
        }
        return { data }
      },
    }),

    insertRecord: tool({
      description: "Insert a new record into a table. RLS will prevent unauthorized inserts.",
      parameters: z.object({
        table: z.string(),
        record: z.record(z.any()).describe("A JSON object representing the row to insert"),
      }),
      execute: async ({ table, record }) => {
        const { data, error } = await supabase.from(table).insert(record).select()
        if (error) {
          console.error(`[mcp] insertRecord error: ${error.message}`)
          return { error: error.message }
        }
        return { success: true, data }
      },
    }),

    updateRecord: tool({
      description: "Update an existing record in a table by its ID. RLS will prevent unauthorized updates.",
      parameters: z.object({
        table: z.string(),
        id: z.string().describe("The UUID of the record to update"),
        updates: z.record(z.any()).describe("A JSON object representing the fields to update"),
      }),
      execute: async ({ table, id, updates }) => {
        const { data, error } = await supabase.from(table).update(updates).eq("id", id).select()
        if (error) {
          console.error(`[mcp] updateRecord error: ${error.message}`)
          return { error: error.message }
        }
        return { success: true, data }
      },
    }),
  }
}
