import { NextResponse } from "next/server"
import { requireProfile } from "@/lib/auth"

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
  const dbUrl = process.env.POSTGRES_URL ?? process.env.DATABASE_URL ?? ""
  const embeddingModel = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small"

  const checks: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    architecture: "native (Next.js serverless)",
    env: {
      OPENROUTER_API_KEY: openrouterKey ? "✅ set" : "❌ missing",
      POSTGRES_URL: dbUrl ? "✅ set" : "❌ missing",
      EMBEDDING_MODEL: embeddingModel,
      SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ? "✅ set" : "❌ missing",
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? "✅ set" : "❌ missing",
    },
  }

  // Check direct Postgres connectivity
  if (dbUrl) {
    try {
      const { Pool } = await import("pg")
      const pool = new Pool({
        connectionString: dbUrl,
        max: 1,
        connectionTimeoutMillis: 5_000,
      })
      const client = await pool.connect()
      const result = await client.query(
        "SELECT COUNT(*) as count FROM rag_documents"
      )
      client.release()
      await pool.end()

      checks.database = {
        status: "✅ connected",
        rag_documents_count: parseInt(result.rows[0].count, 10),
      }
    } catch (err: any) {
      checks.database = {
        status: "❌ error",
        error: err?.message ?? String(err),
      }
    }
  } else {
    checks.database = { status: "❌ not configured" }
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
