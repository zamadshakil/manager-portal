import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
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
  let profile: Awaited<ReturnType<typeof requireRole>>
  try {
    profile = await requireRole(["main_admin", "manager"])
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

  // Guard against double-registration
  if ((row as any).archive_status !== "pending") {
    return NextResponse.json({ ok: true, materialId, alreadyRegistered: true })
  }

  // Advance status to "processing"
  const { error: updateError } = await supabase
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
