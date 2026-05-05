import { NextResponse } from "next/server"
import { requireProfile } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"

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

  const checks: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    architecture: "native (Supabase JS RPCs)",
    env: {
      OPENROUTER_API_KEY: openrouterKey ? "✅ set" : "❌ missing",
      EMBEDDING_MODEL: embeddingModel,
      SUPABASE_URL: supabaseUrl ? "✅ set" : "❌ missing",
      SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRole ? "✅ set" : "❌ missing",
    },
  }

  // Check Supabase connectivity & rag_documents count
  if (supabaseUrl && supabaseServiceRole) {
    try {
      const supabase = createAdminClient()
      const { count, error } = await supabase
        .from("rag_documents")
        .select("*", { count: "exact", head: true })

      if (error) {
        throw new Error(error.message)
      }

      checks.database = {
        status: "✅ connected",
        rag_documents_count: count ?? 0,
      }
    } catch (err: any) {
      checks.database = {
        status: "❌ error",
        error: err?.message ?? String(err),
      }
    }
  } else {
    checks.database = { status: "❌ Supabase not fully configured" }
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
