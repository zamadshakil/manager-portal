"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/auth"
import { logActivity } from "@/lib/activity"

const Schema = z.object({
  rule_name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(1_000).optional().or(z.literal("")),
  prompt_template: z.string().trim().min(20).max(4_000),
  threshold: z.coerce.number().min(0).max(100),
  weight: z.coerce.number().min(0).max(10),
  enabled: z.coerce.boolean().optional(),
})

export async function upsertRule(formData: FormData) {
  const profile = await requireRole(["main_admin", "manager"])

  const parsed = Schema.safeParse({
    rule_name: formData.get("rule_name") || "",
    description: formData.get("description") ?? "",
    prompt_template: formData.get("prompt_template") || "",
    threshold: formData.get("threshold") || "0",
    weight: formData.get("weight") || "0",
    enabled: formData.get("enabled") === "on" || formData.get("enabled") === "true",
  })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }

  const id = String(formData.get("id") || "")
  const supabase = await createClient()

  if (id) {
    // For updates, check permission
    const { data: existingRule } = await supabase
      .from("validation_rules")
      .select("id, created_by, profiles!created_by(role)")
      .eq("id", id)
      .single()

    if (!existingRule) {
      return { ok: false, error: "Rule not found." }
    }

    // Permission check: Managers cannot edit rules created by main_admin
    const creatorRole = (existingRule as any).profiles?.role
    if (profile.role === "manager" && creatorRole === "main_admin") {
      return { ok: false, error: "Managers cannot edit rules created by the main admin." }
    }

    const { error } = await supabase
      .from("validation_rules")
      .update({
        rule_name: parsed.data.rule_name,
        description: parsed.data.description || null,
        prompt_template: parsed.data.prompt_template,
        threshold: parsed.data.threshold,
        weight: parsed.data.weight,
        enabled: !!parsed.data.enabled,
      })
      .eq("id", id)
    if (error) return { ok: false, error: error.message }
    await logActivity({
      actorId: profile.id,
      teamId: profile.team_id || null, // Log the actor's team context if they have one
      action: "rule.updated",
      entityType: "validation_rule",
      entityId: id,
    })
  } else {
    const { data, error } = await supabase
      .from("validation_rules")
      .insert({
        team_id: profile.role === "main_admin" ? null : (profile.team_id || null),
        rule_name: parsed.data.rule_name,
        description: parsed.data.description || null,
        prompt_template: parsed.data.prompt_template,
        threshold: parsed.data.threshold,
        weight: parsed.data.weight,
        enabled: !!parsed.data.enabled,
        created_by: profile.id,
      })
      .select("id")
      .single()
    if (error || !data) return { ok: false, error: error?.message ?? "Could not create rule." }
    await logActivity({
      actorId: profile.id,
      teamId: profile.team_id || null,
      action: "rule.created",
      entityType: "validation_rule",
      entityId: data.id,
    })
  }

  revalidatePath("/dashboard/rules")
  return { ok: true }
}

export async function deleteRule(formData: FormData) {
  const profile = await requireRole(["main_admin", "manager"])
  const id = String(formData.get("id") || "")
  const supabase = await createClient()

  // Verify rule exists and check permission
  const { data: rule } = await supabase
    .from("validation_rules")
    .select("id, created_by, profiles!created_by(role)")
    .eq("id", id)
    .single()

  if (!rule) {
    return { ok: false, error: "Rule not found." }
  }

  // Permission check: Managers cannot delete rules created by main_admin
  const creatorRole = (rule as any).profiles?.role
  if (profile.role === "manager" && creatorRole === "main_admin") {
    return { ok: false, error: "Managers cannot delete rules created by the main admin." }
  }

  const { error } = await supabase.from("validation_rules").delete().eq("id", id)
  if (error) return { ok: false, error: error.message }

  await logActivity({
    actorId: profile.id,
    teamId: profile.team_id || null,
    action: "rule.deleted",
    entityType: "validation_rule",
    entityId: id,
  })
  revalidatePath("/dashboard/rules")
  return { ok: true }
}
