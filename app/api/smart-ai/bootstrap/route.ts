import { NextResponse } from "next/server"
import { requireProfile } from "@/lib/auth"
import { ensureRagSchema, getRagBootstrapState } from "@/lib/smart-ai/bootstrap"
import { isDirectPgConfigured } from "@/lib/smart-ai/pg-client"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/smart-ai/bootstrap
 *
 * Manually run the RAG schema bootstrap. Useful right after deploy, when
 * the auto-bootstrap-on-first-use behavior hasn't fired yet, or when an
 * earlier bootstrap attempt cached a failure that needs re-running.
 *
 * Body (optional): { force: boolean }
 *
 * Auth: any signed-in user (the bootstrap is idempotent and exposes no
 * data — restrict further if your environment requires admin-only).
 */
export async function POST(req: Request) {
  try {
    await requireProfile()
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let force = false
  try {
    const body = (await req.json().catch(() => null)) as { force?: boolean } | null
    force = Boolean(body?.force)
  } catch {
    // ignore — body is optional
  }

  if (!isDirectPgConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        reason:
          "direct PG connection not configured — set SUPABASE_DB_URL or DATABASE_URL on the manager-portal Railway service to enable bootstrap, or apply supabase/migrations/20260506_rag_rpc.sql manually in Supabase Studio.",
      },
      { status: 400 },
    )
  }

  const result = await ensureRagSchema({ force })
  return NextResponse.json(
    { ...result, requested: { force } },
    { status: result.ok ? 200 : 500, headers: { "cache-control": "no-store" } },
  )
}

/**
 * GET /api/smart-ai/bootstrap
 *
 * Read-only status of the in-process bootstrap cache. Doesn't trigger
 * a run.
 */
export async function GET() {
  try {
    await requireProfile()
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  return NextResponse.json(
    {
      direct_pg_configured: isDirectPgConfigured(),
      state: getRagBootstrapState(),
    },
    { headers: { "cache-control": "no-store" } },
  )
}
