import { NextResponse } from "next/server"
import { requireProfile } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { isDirectPgConfigured, pgPing, pgQuery } from "@/lib/smart-ai/pg-client"
import { ensureRagSchema, getRagBootstrapState } from "@/lib/smart-ai/bootstrap"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/smart-ai/health
 *
 * Diagnostic endpoint that checks the native RAG pipeline health.
 * All AI orchestration now runs natively in Next.js — no external
 * MCP or RAG services needed.
 */
export async function GET() {
  await requireProfile()

  const openrouterKey = process.env.OPENROUTER_API_KEY ?? ""
  const embeddingModel = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small"
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""

  const directPgUrl =
    process.env.SUPABASE_DB_URL ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_PRISMA_URL ??
    ""

  const checks: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    architecture: "native (direct-pg → rpc → postgrest fallback chain)",
    env: {
      OPENROUTER_API_KEY: openrouterKey ? "set" : "missing",
      EMBEDDING_MODEL: embeddingModel,
      SUPABASE_URL: supabaseUrl ? "set" : "missing",
      SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRole ? "set" : "missing",
      DIRECT_PG_URL: directPgUrl ? "set" : "missing (recommended for reliability)",
    },
  }

  // (a) Direct Postgres connection — the bulletproof path.
  if (isDirectPgConfigured()) {
    // Run the auto-bootstrap so the health check itself can fix the
    // schema if it's stale. This is idempotent and cached per-process.
    const bootstrap = await ensureRagSchema()

    try {
      const version = await pgPing()
      const fnCheck = await pgQuery<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM pg_proc p
           JOIN pg_namespace n ON p.pronamespace = n.oid
           WHERE n.nspname = 'public' AND p.proname = 'insert_rag_chunks'
         ) AS exists`,
      )
      const colCheck = await pgQuery<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'rag_documents'
             AND column_name = 'chunk_index'
         ) AS exists`,
      )
      const countRes = await pgQuery<{ n: string }>(`SELECT COUNT(*)::text AS n FROM rag_documents`)
      checks.direct_pg = {
        status: "ok",
        version: version.split(",")[0],
        rag_documents_count: Number(countRes.rows[0]?.n ?? 0),
        chunk_index_column_exists: colCheck.rows[0]?.exists === true,
        insert_rag_chunks_function_exists: fnCheck.rows[0]?.exists === true,
        bootstrap: {
          ok: bootstrap.ok,
          ranAt: bootstrap.ranAt,
          reason: bootstrap.reason,
          steps: bootstrap.steps,
        },
      }
    } catch (err: any) {
      checks.direct_pg = {
        status: "error",
        error: err?.message ?? String(err),
        bootstrap: {
          ok: bootstrap.ok,
          reason: bootstrap.reason,
        },
      }
    }
  } else {
    checks.direct_pg = {
      status: "not configured",
      hint: "Set SUPABASE_DB_URL or DATABASE_URL on manager-portal to enable the bulletproof insert path AND auto-bootstrap of the rag_documents schema + RPCs.",
    }
    checks.bootstrap = getRagBootstrapState()
  }

  // (b) Supabase admin client (PostgREST) — count rows.
  if (supabaseUrl && supabaseServiceRole) {
    try {
      const supabase = createAdminClient()
      const { count, error } = await supabase
        .from("rag_documents")
        .select("*", { count: "exact", head: true })
      if (error) throw new Error(error.message)
      checks.postgrest = {
        status: "ok",
        rag_documents_count: count ?? 0,
      }
    } catch (err: any) {
      checks.postgrest = {
        status: "error",
        error: err?.message ?? String(err),
      }
    }
  } else {
    checks.postgrest = { status: "Supabase not fully configured" }
  }

  // Check OpenRouter embedding endpoint
  if (openrouterKey) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { authorization: `Bearer ${openrouterKey}` },
        signal: AbortSignal.timeout(5_000),
      })
      checks.embeddings = {
        status: res.ok ? "✅ reachable" : `⚠️ status ${res.status}`,
        model: embeddingModel,
      }
    } catch (err: any) {
      checks.embeddings = {
        status: "❌ unreachable",
        error: err?.message ?? String(err),
      }
    }
  } else {
    checks.embeddings = { status: "❌ no API key" }
  }

  return NextResponse.json(checks, {
    headers: { "cache-control": "no-store" },
  })
}
