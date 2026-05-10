import { NextResponse } from "next/server"
import { requireProfile } from "@/lib/auth"
import { AccessDeniedError, assertCapability, CAPABILITIES } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { processArchiveBackground } from "@/lib/archive-processor"
import { revalidatePath } from "next/cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/materials/register
 *
 * Called by the client after the direct-to-R2 upload completes.  Marks the
 * placeholder row as "processing" and fires the async text extraction job.
 *
 * Body JSON:
 *   { materialId }
 */
export async function POST(req: Request) {
  let profile: Awaited<ReturnType<typeof requireProfile>>
  try {
    profile = await requireProfile()
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: { materialId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { materialId } = body
  if (!materialId) {
    return NextResponse.json({ error: "materialId is required." }, { status: 400 })
  }

  // Fetch the placeholder row — verify ownership
  const supabase = await createClient()
  const { data: row, error: fetchError } = (await supabase
    .from("materials")
    .select("*")
    .eq("id", materialId)
    .single()) as { data: any; error: any }

  if (fetchError || !row) {
    return NextResponse.json({ error: "Material not found." }, { status: 404 })
  }

  // Only the original author (or main_admin) may complete the upload
  if (profile.role !== "main_admin" && row.author_id !== profile.id) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 })
  }

  try {
    await assertCapability(profile, CAPABILITIES.MATERIALS_CREATE, {
      team_id: row.team_id,
      is_global: row.team_id === null,
    })
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      return NextResponse.json({ error: "You do not have permission to finish this upload." }, { status: 403 })
    }
    throw err
  }

  // Guard against double-registration
  if ((row as any).archive_status !== "pending") {
    return NextResponse.json({ ok: true, materialId, alreadyRegistered: true })
  }

  // Advance status to "processing" — use admin client to bypass role-only write RLS
  const adminClient = createAdminClient()
  const { error: updateError } = await adminClient
    .from("materials")
    .update({ archive_status: "processing" } as any)
    .eq("id", materialId)

  if (updateError) {
    console.error("[register] status update failed:", updateError.message)
    return NextResponse.json({ error: "Could not update material status." }, { status: 500 })
  }

  // Fire background extraction (non-blocking)
  void processArchiveBackground(
    materialId,
    row.blob_url,
    row.file_type ?? "application/zip",
    row.team_id ?? null,
    profile.id,
    row.title,
  )

  revalidatePath("/dashboard/materials")

  return NextResponse.json({ ok: true, materialId })
}
