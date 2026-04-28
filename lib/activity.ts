import { headers } from "next/headers"
import { createAdminClient } from "@/lib/supabase/admin"

interface LogParams {
  actorId: string | null
  teamId: string | null
  action: string
  entityType: string
  entityId?: string | null
  metadata?: Record<string, unknown>
}

/**
 * Append-only audit log writer. Uses the service-role client because the log
 * is intentionally write-once: clients can SELECT but cannot INSERT/UPDATE/
 * DELETE arbitrary rows. The RLS insert policy restricts user-driven inserts;
 * service-role bypasses RLS so we always control attribution.
 */
export async function logActivity(params: LogParams) {
  try {
    const h = await headers()
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null
    const ua = h.get("user-agent") ?? null

    const admin = createAdminClient()
    await admin.from("activity_log").insert({
      actor_id: params.actorId,
      team_id: params.teamId,
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId ?? null,
      metadata: params.metadata ?? {},
      ip_address: ip,
      user_agent: ua,
    })
  } catch (err) {
    console.error("[activity] log failed", err)
  }
}
