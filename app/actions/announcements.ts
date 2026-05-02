"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/auth"
import { logActivity } from "@/lib/activity"

const Schema = z.object({
  title: z.string().trim().min(2).max(200),
  body: z.string().trim().min(2).max(5_000),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  target: z.string(),
})

export interface ActionResult {
  ok: boolean
  error?: string
}

export async function createAnnouncement(formData: FormData): Promise<ActionResult> {
  const profile = await requireRole(["main_admin", "manager"])
  const parsed = Schema.safeParse({
    title: formData.get("title") || "",
    body: formData.get("body") || "",
    priority: formData.get("priority") || undefined,
    target: formData.get("target") || "global",
  })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }

  let teamId: string | null = null
  if (parsed.data.target === "global") {
    if (profile.role !== "main_admin") {
      return { ok: false, error: "Only Main Admin can post global announcements." }
    }
    teamId = null
  } else {
    // If manager, enforce their own team_id
    if (profile.role === "manager" && parsed.data.target !== profile.team_id) {
      return { ok: false, error: "Managers can only post to their own team." }
    }
    teamId = parsed.data.target
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("announcements")
    .insert({
      author_id: profile.id,
      team_id: teamId,
      title: parsed.data.title,
      body: parsed.data.body,
      priority: parsed.data.priority,
    })
    .select("id")
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? "Could not post." }

  await logActivity({
    actorId: profile.id,
    teamId,
    action: "announcement.created",
    entityType: "announcement",
    entityId: data.id,
    metadata: { priority: parsed.data.priority, target: parsed.data.target },
  })

  revalidatePath("/dashboard")
  revalidatePath("/dashboard/announcements")
  return { ok: true }
}

export async function deleteAnnouncement(formData: FormData): Promise<ActionResult> {
  const profile = await requireRole(["main_admin", "manager"])
  const id = String(formData.get("id") || "")
  const supabase = await createClient()
  const { data: row } = await supabase.from("announcements").select("id, team_id").eq("id", id).single()
  if (!row) return { ok: false, error: "Not found" }

  // Managers can only delete announcements from their own team.
  if (profile.role === "manager" && row.team_id !== profile.team_id) {
    return { ok: false, error: "Not authorized to delete this announcement." }
  }

  const { error } = await supabase.from("announcements").delete().eq("id", id)
  if (error) return { ok: false, error: error.message }

  await logActivity({
    actorId: profile.id,
    teamId: row.team_id,
    action: "announcement.deleted",
    entityType: "announcement",
    entityId: id,
  })

  revalidatePath("/dashboard")
  revalidatePath("/dashboard/announcements")
  return { ok: true }
}
