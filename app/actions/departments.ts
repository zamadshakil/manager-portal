"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireRole } from "@/lib/auth"
import { logActivity } from "@/lib/activity"

export interface DepartmentActionResult {
  ok: boolean
  error?: string
  departmentId?: string
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

const CreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  description: z.string().trim().max(500).optional().or(z.literal("")),
})

export async function createDepartment(
  formData: FormData,
): Promise<DepartmentActionResult> {
  const actor = await requireRole(["main_admin"])

  const parsed = CreateSchema.safeParse({
    name: formData.get("name") || "",
    description: formData.get("description") ?? "",
  })
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("teams")
    .insert({
      name: parsed.data.name,
      description: parsed.data.description || null,
      settings: {},
    })
    .select("id")
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? "Could not create department." }

  await logActivity({
    actorId: actor.id,
    teamId: data.id,
    action: "department.created",
    entityType: "team",
    entityId: data.id,
    metadata: { name: parsed.data.name },
  })

  revalidatePath("/dashboard/departments")
  return { ok: true, departmentId: data.id }
}

// ---------------------------------------------------------------------------
// Update (rename / description)
// ---------------------------------------------------------------------------

const UpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required").max(100),
  description: z.string().trim().max(500).optional().or(z.literal("")),
})

export async function updateDepartment(
  formData: FormData,
): Promise<DepartmentActionResult> {
  const actor = await requireRole(["main_admin"])

  const parsed = UpdateSchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name") || "",
    description: formData.get("description") ?? "",
  })
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }

  const supabase = await createClient()
  const { error } = await supabase
    .from("teams")
    .update({
      name: parsed.data.name,
      description: parsed.data.description || null,
    })
    .eq("id", parsed.data.id)

  if (error) return { ok: false, error: error.message }

  await logActivity({
    actorId: actor.id,
    teamId: parsed.data.id,
    action: "department.updated",
    entityType: "team",
    entityId: parsed.data.id,
    metadata: { name: parsed.data.name },
  })

  revalidatePath("/dashboard/departments")
  revalidatePath(`/dashboard/departments/${parsed.data.id}`)
  return { ok: true, departmentId: parsed.data.id }
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

const DeleteSchema = z.object({ id: z.string().uuid() })

export async function deleteDepartment(
  formData: FormData,
): Promise<DepartmentActionResult> {
  const actor = await requireRole(["main_admin"])

  const parsed = DeleteSchema.safeParse({ id: formData.get("id") })
  if (!parsed.success) return { ok: false, error: "Invalid department id" }

  const admin = createAdminClient()

  // Unassign all members from this team before deleting
  await admin
    .from("profiles")
    .update({ team_id: null })
    .eq("team_id", parsed.data.id)

  const supabase = await createClient()
  const { error } = await supabase.from("teams").delete().eq("id", parsed.data.id)
  if (error) return { ok: false, error: error.message }

  await logActivity({
    actorId: actor.id,
    teamId: null,
    action: "department.deleted",
    entityType: "team",
    entityId: parsed.data.id,
  })

  revalidatePath("/dashboard/departments")
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Assign member to department
// ---------------------------------------------------------------------------

const AssignMemberSchema = z.object({
  department_id: z.string().uuid(),
  profile_id: z.string().uuid(),
})

export async function assignMemberToDepartment(
  formData: FormData,
): Promise<DepartmentActionResult> {
  const actor = await requireRole(["main_admin"])

  const parsed = AssignMemberSchema.safeParse({
    department_id: formData.get("department_id") || undefined,
    profile_id: formData.get("profile_id") || undefined,
  })
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }

  const admin = createAdminClient()
  const { error } = await admin
    .from("profiles")
    .update({ team_id: parsed.data.department_id })
    .eq("id", parsed.data.profile_id)

  if (error) return { ok: false, error: error.message }

  await logActivity({
    actorId: actor.id,
    teamId: parsed.data.department_id,
    action: "department.member_assigned",
    entityType: "profile",
    entityId: parsed.data.profile_id,
    metadata: { department_id: parsed.data.department_id },
  })

  revalidatePath("/dashboard/departments")
  revalidatePath(`/dashboard/departments/${parsed.data.department_id}`)
  revalidatePath("/dashboard/team")
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Remove member from department
// ---------------------------------------------------------------------------

const RemoveMemberSchema = z.object({
  department_id: z.string().uuid(),
  profile_id: z.string().uuid(),
})

export async function removeMemberFromDepartment(
  formData: FormData,
): Promise<DepartmentActionResult> {
  const actor = await requireRole(["main_admin"])

  const parsed = RemoveMemberSchema.safeParse({
    department_id: formData.get("department_id") || undefined,
    profile_id: formData.get("profile_id") || undefined,
  })
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }

  const admin = createAdminClient()

  // If this person is the manager of the dept, also clear manager_id on the team
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", parsed.data.profile_id)
    .single()

  if (profile?.role === "manager") {
    await admin
      .from("teams")
      .update({ manager_id: null })
      .eq("id", parsed.data.department_id)
      .eq("manager_id", parsed.data.profile_id)
  }

  const { error } = await admin
    .from("profiles")
    .update({ team_id: null })
    .eq("id", parsed.data.profile_id)

  if (error) return { ok: false, error: error.message }

  await logActivity({
    actorId: actor.id,
    teamId: parsed.data.department_id,
    action: "department.member_removed",
    entityType: "profile",
    entityId: parsed.data.profile_id,
  })

  revalidatePath("/dashboard/departments")
  revalidatePath(`/dashboard/departments/${parsed.data.department_id}`)
  revalidatePath("/dashboard/team")
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Set / change manager of a department
// ---------------------------------------------------------------------------

const SetManagerSchema = z.object({
  department_id: z.string().uuid(),
  // pass "" to clear the manager
  profile_id: z.string().uuid().optional().or(z.literal("")),
})

export async function setDepartmentManager(
  formData: FormData,
): Promise<DepartmentActionResult> {
  const actor = await requireRole(["main_admin"])

  const parsed = SetManagerSchema.safeParse({
    department_id: formData.get("department_id") || undefined,
    profile_id: formData.get("profile_id") ?? "",
  })
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }

  const admin = createAdminClient()
  const newManagerId = parsed.data.profile_id || null

  // Update the team's manager_id
  const { error: teamError } = await admin
    .from("teams")
    .update({ manager_id: newManagerId })
    .eq("id", parsed.data.department_id)

  if (teamError) return { ok: false, error: teamError.message }

  // If assigning a new manager, ensure they belong to this dept and have manager role
  if (newManagerId) {
    await admin
      .from("profiles")
      .update({ team_id: parsed.data.department_id, role: "manager" })
      .eq("id", newManagerId)
  }

  await logActivity({
    actorId: actor.id,
    teamId: parsed.data.department_id,
    action: "department.manager_set",
    entityType: "team",
    entityId: parsed.data.department_id,
    metadata: { manager_id: newManagerId },
  })

  revalidatePath("/dashboard/departments")
  revalidatePath(`/dashboard/departments/${parsed.data.department_id}`)
  revalidatePath("/dashboard/team")
  return { ok: true }
}
