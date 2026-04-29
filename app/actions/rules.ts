"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/auth"
import { logActivity } from "@/lib/activity"

const Schema = z.object({
  team_id: z.string().uuid("Invalid team ID").optional(),
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
    team_id: formData.get("team_id"),
    rule_name: formData.get("rule_name"),
    description: formData.get("description") ?? "",
    prompt_template: formData.get("prompt_template"),
    threshold: formData.get("threshold"),
    weight: formData.get("weight"),
    enabled: formData.get("enabled") === "on" || formData.get("enabled") === "true",
  })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }

  // Determine team_id: use explicit team_id if provided, otherwise use profile's team_id
  const teamId = parsed.data.team_id || profile.team_id
  if (!teamId) {
    return { ok: false, error: "No team specified or assigned." }
  }

  // Manager can only manage their own team
  if (profile.role === "manager" && profile.team_id !== teamId) {
    return { ok: false, error: "You can only manage rules for your own team." }
  }

  const id = String(formData.get("id") || "")
  const supabase = await createClient()

  if (id) {
    // For updates, verify the rule belongs to the specified team
    const { data: existingRule } = await supabase
      .from("validation_rules")
      .select("team_id")
      .eq("id", id)
      .single()

    if (!existingRule || existingRule.team_id !== teamId) {
      return { ok: false, error: "Rule not found or does not belong to your team." }
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
      teamId,
      action: "rule.updated",
      entityType: "validation_rule",
      entityId: id,
    })
  } else {
    const { data, error } = await supabase
      .from("validation_rules")
      .insert({
        team_id: teamId,
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
      teamId,
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

  // Verify rule exists and belongs to user's team (for managers)
  const { data: rule } = await supabase
    .from("validation_rules")
    .select("team_id")
    .eq("id", id)
    .single()

  if (!rule) {
    return { ok: false, error: "Rule not found." }
  }

  // Manager can only delete rules from their own team
  if (profile.role === "manager" && profile.team_id !== rule.team_id) {
    return { ok: false, error: "You can only delete rules from your own team." }
  }

  const { error } = await supabase.from("validation_rules").delete().eq("id", id)
  if (error) return { ok: false, error: error.message }

  await logActivity({
    actorId: profile.id,
    teamId: rule.team_id,
    action: "rule.deleted",
    entityType: "validation_rule",
    entityId: id,
  })
  revalidatePath("/dashboard/rules")
  return { ok: true }
}
