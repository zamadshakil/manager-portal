import { NextResponse } from "next/server"
import { requireProfile } from "@/lib/auth"
import {
  fallbackAnalytics,
  fetchRagAnalytics,
  scopeForProfile,
} from "@/lib/smart-ai/client"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Returns RAG service analytics scoped to the calling profile. Falls back
 * to a deterministic empty payload when the service is not yet wired so
 * the dashboard renders without a loading-error flash.
 */
export async function GET(req: Request) {
  const profile = await requireProfile()
  const scope = scopeForProfile(profile)

  const live = await fetchRagAnalytics({ scope, signal: req.signal }).catch(() => null)
  if (live) {
    return NextResponse.json(
      { source: "rag", scope, data: live },
      { headers: { "cache-control": "private, max-age=15" } },
    )
  }

  return NextResponse.json(
    { source: "fallback", scope, data: fallbackAnalytics(scope) },
    { headers: { "cache-control": "private, max-age=15" } },
  )
}
