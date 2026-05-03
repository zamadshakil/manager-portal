import { NextResponse } from "next/server"
import { requireProfile } from "@/lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/smart-ai/health
 *
 * Diagnostic endpoint that checks connectivity to both the MCP and RAG
 * services. Returns a structured JSON report for debugging deployment
 * issues — especially useful when the AI reports "cannot retrieve data."
 */
export async function GET() {
  await requireProfile()

  const mcpUrl = process.env.MCP_SERVICE_URL ?? ""
  const mcpToken = process.env.MCP_SERVICE_TOKEN ?? ""
  const ragUrl = process.env.RAG_SERVICE_URL ?? ""
  const ragToken = process.env.RAG_SERVICE_TOKEN ?? ""
  const openrouterKey = process.env.OPENROUTER_API_KEY ?? ""

  const checks: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    env: {
      MCP_SERVICE_URL: mcpUrl ? "✅ set" : "❌ missing",
      MCP_SERVICE_TOKEN: mcpToken ? "✅ set" : "❌ missing",
      RAG_SERVICE_URL: ragUrl ? "✅ set" : "❌ missing",
      RAG_SERVICE_TOKEN: ragToken ? "✅ set" : "❌ missing",
      OPENROUTER_API_KEY: openrouterKey ? "✅ set" : "❌ missing",
      SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ? "✅ set" : "❌ missing",
    },
  }

  // Check MCP service health
  if (mcpUrl) {
    try {
      const res = await fetch(`${mcpUrl.replace(/\/$/, "")}/health`, {
        headers: mcpToken ? { authorization: `Bearer ${mcpToken}` } : {},
        signal: AbortSignal.timeout(5_000),
      })
      const body = await res.json().catch(() => null)
      checks.mcp = {
        status: res.ok ? "✅ healthy" : `⚠️ status ${res.status}`,
        url: mcpUrl,
        response: body,
      }
    } catch (err: any) {
      checks.mcp = {
        status: "❌ unreachable",
        url: mcpUrl,
        error: err?.message ?? String(err),
      }
    }
  } else {
    checks.mcp = { status: "❌ not configured" }
  }

  // Check RAG service health
  if (ragUrl) {
    try {
      const res = await fetch(`${ragUrl.replace(/\/$/, "")}/health`, {
        headers: ragToken ? { authorization: `Bearer ${ragToken}` } : {},
        signal: AbortSignal.timeout(5_000),
      })
      const body = await res.json().catch(() => null)
      checks.rag = {
        status: res.ok ? "✅ healthy" : `⚠️ status ${res.status}`,
        url: ragUrl,
        response: body,
      }
    } catch (err: any) {
      checks.rag = {
        status: "❌ unreachable",
        url: ragUrl,
        error: err?.message ?? String(err),
      }
    }
  } else {
    checks.rag = { status: "❌ not configured" }
  }

  return NextResponse.json(checks, {
    headers: { "cache-control": "no-store" },
  })
}
