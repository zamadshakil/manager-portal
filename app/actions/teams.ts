"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireRole } from "@/lib/auth"
import { logActivity } from "@/lib/activity"

const CreateTeamSchema = z.object({
  name: z.string().trim().min(2).max(100, "Team name must be between 2 and 100 characters"),
  description: z.string().trim().max(500, "Description too long").optional().or(z.literal("")),
  manager_id: z.string().uuid().optional().or(z.literal("")),
})

const UpdateTeamSchema = z.object({
  team_id: z.string().uuid("Invalid team ID"),
  name: z.string().trim().min(2).max(100, "Team name must be between 2 and 100 characters"),
  description: z.string().trim().max(500, "Description too long").optional().or(z.literal("")),
  manager_id: z.string().uuid().optional().or(z.literal("")),
})

/**
 * Create a new team. Only main_admin can create teams.
 */
export async function createTeam(formData: FormData) {
  const profile = await requireRole(["main_admin"])

  const parsed = CreateTeamSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    manager_id: formData.get("manager_id") ?? "",
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const admin = createAdminClient()

  try {
    const { data: team, error } = await admin
      .from("teams")
      .insert({
        name: parsed.data.name,
        description: parsed.data.description || null,
        manager_id: parsed.data.manager_id || null,
      })
      .select("id")
      .single()

    if (error || !team) {
      return { ok: false, error: error?.message ?? "Could not create team" }
    }

    await logActivity({
      actorId: profile.id,
      teamId: team.id,
      action: "team.created",
      entityType: "team",
      entityId: team.id,
      metadata: { name: parsed.data.name },
    })

    revalidatePath("/dashboard/team")
    revalidatePath("/dashboard/tasks")
    return { ok: true, teamId: team.id }
  } catch (error) {
    console.error("[Teams] createTeam error:", error)
    return { ok: false, error: "An error occurred while creating the team" }
  }
}

/**
 * Update an existing team. Only main_admin can update teams.
 */
export async function updateTeam(formData: FormData) {
  const profile = await requireRole(["main_admin"])

  const parsed = UpdateTeamSchema.safeParse({
    team_id: formData.get("team_id"),
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    manager_id: formData.get("manager_id") ?? "",
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const admin = createAdminClient()

  try {
    const { error } = await admin
      .from("teams")
      .update({
        name: parsed.data.name,
        description: parsed.data.description || null,
        manager_id: parsed.data.manager_id || null,
      })
      .eq("id", parsed.data.team_id)

    if (error) {
      return { ok: false, error: error.message }
    }

    await logActivity({
      actorId: profile.id,
      teamId: parsed.data.team_id,
      action: "team.updated",
      entityType: "team",
      entityId: parsed.data.team_id,
      metadata: { name: parsed.data.name },
    })

    revalidatePath("/dashboard/team")
    revalidatePath("/dashboard/tasks")
    return { ok: true }
  } catch (error) {
    console.error("[Teams] updateTeam error:", error)
    return { ok: false, error: "An error occurred while updating the team" }
  }
}

/**
 * Delete a team. Only main_admin can delete teams.
 * Returns error if team has active tasks or members.
 */
export async function deleteTeam(formData: FormData) {
  const profile = await requireRole(["main_admin"])
  const teamId = String(formData.get("team_id") || "")

  if (!teamId) {
    return { ok: false, error: "Team ID required" }
  }

  const admin = createAdminClient()

  try {
    // Check if team has active tasks
    const { count: taskCount } = await admin
      .from("tasks")
      .select("id", { count: "exact" })
      .eq("team_id", teamId)

    if ((taskCount ?? 0) > 0) {
      return {
        ok: false,
        error: `Cannot delete team with active tasks (${taskCount} found)`,
      }
    }

    // Check if team has members
    const { count: memberCount } = await admin
      .from("profiles")
      .select("id", { count: "exact" })
      .eq("team_id", teamId)
      .neq("role", "main_admin") // Admins aren't really "members"

    if ((memberCount ?? 0) > 0) {
      return {
        ok: false,
        error: `Cannot delete team with members (${memberCount} found)`,
      }
    }

    const { error } = await admin.from("teams").delete().eq("id", teamId)

    if (error) {
      return { ok: false, error: error.message }
    }

    await logActivity({
      actorId: profile.id,
      teamId,
      action: "team.deleted",
      entityType: "team",
      entityId: teamId,
    })

    revalidatePath("/dashboard/team")
    revalidatePath("/dashboard/tasks")
    return { ok: true }
  } catch (error) {
    console.error("[Teams] deleteTeam error:", error)
    return { ok: false, error: "An error occurred while deleting the team" }
  }
}

/**
 * Assign a manager to a team. Only main_admin can do this.
 */
export async function assignTeamManager(formData: FormData) {
  const profile = await requireRole(["main_admin"])
  const teamId = String(formData.get("team_id") || "")
  const managerId = String(formData.get("manager_id") || "")

  if (!teamId || !managerId) {
    return { ok: false, error: "Team ID and manager ID required" }
  }

  const admin = createAdminClient()

  try {
    // Verify manager exists and has manager role
    const { data: manager } = await admin
      .from("profiles")
      .select("id, role")
      .eq("id", managerId)
      .single()

    if (!manager || manager.role !== "manager") {
      return { ok: false, error: "Invalid manager or user is not a manager" }
    }

    // Update team
    const { error } = await admin
      .from("teams")
      .update({ manager_id: managerId })
      .eq("id", teamId)

    if (error) {
      return { ok: false, error: error.message }
    }

    // Also update the manager's team_id if needed
    const { error: managerUpdateError } = await admin
      .from("profiles")
      .update({ team_id: teamId })
      .eq("id", managerId)

    if (managerUpdateError) {
      console.error("[Teams] Error updating manager team_id:", managerUpdateError)
      return { ok: false, error: "Failed to assign manager to team" }
    }

    await logActivity({
      actorId: profile.id,
      teamId,
      action: "team.manager_assigned",
      entityType: "team",
      entityId: teamId,
      metadata: { manager_id: managerId },
    })

    revalidatePath("/dashboard/team")
    revalidatePath("/dashboard/tasks")
    return { ok: true }
  } catch (error) {
    console.error("[Teams] assignTeamManager error:", error)
    return { ok: false, error: "An error occurred while assigning the manager" }
  }
}
