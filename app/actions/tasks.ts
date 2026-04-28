"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireRole, canManageTeam } from "@/lib/auth"
import { logActivity } from "@/lib/activity"

export interface TaskActionResult {
  ok: boolean
  error?: string
  taskId?: string
  assignedCount?: number
}

const CreateTaskSchema = z.object({
  team_id: z.string().uuid("Pick a team"),
  title: z.string().trim().min(2, "Title is too short").max(200),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  instructions: z.string().trim().max(8000).optional().or(z.literal("")),
  due_at: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  allow_late: z.coerce.boolean().default(true),
  require_late_reason: z.coerce.boolean().default(true),
  // "all" assigns to every member of the team; otherwise a comma-separated
  // list of profile UUIDs (multiple <input name="assignee_ids">).
  assign_mode: z.enum(["all", "selected"]).default("all"),
})

/**
 * Create a task and (optionally) bulk-assign it. Managers can only create for
 * their own team; main_admin can target any team. The function uses the
 * service-role client for bulk assignment to bypass RLS efficiently after the
 * caller's role has been verified.
 */
export async function createTask(formData: FormData): Promise<TaskActionResult> {
  const profile = await requireRole(["main_admin", "manager"])

  const parsed = CreateTaskSchema.safeParse({
    team_id: formData.get("team_id"),
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    instructions: formData.get("instructions") ?? "",
    due_at: formData.get("due_at") ?? "",
    allow_late: formData.get("allow_late") === "on" || formData.get("allow_late") === "true",
    require_late_reason:
      formData.get("require_late_reason") === "on" ||
      formData.get("require_late_reason") === "true",
    assign_mode: formData.get("assign_mode") ?? "all",
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  if (!canManageTeam(profile, parsed.data.team_id)) {
    return { ok: false, error: "You can only create tasks for your own team." }
  }

  const supabase = await createClient()
  const { data: task, error: insertErr } = await supabase
    .from("tasks")
    .insert({
      team_id: parsed.data.team_id,
      manager_id: profile.id,
      title: parsed.data.title,
      description: parsed.data.description || null,
      instructions: parsed.data.instructions || null,
      due_at: parsed.data.due_at,
      allow_late: parsed.data.allow_late,
      require_late_reason: parsed.data.require_late_reason,
    })
    .select("id")
    .single()

  if (insertErr || !task) {
    return { ok: false, error: insertErr?.message ?? "Could not create task." }
  }

  // ---------- Assignments ----------
  const admin = createAdminClient()
  let assignedCount = 0

  if (parsed.data.assign_mode === "all") {
    const { data: members } = await admin
      .from("profiles")
      .select("id")
      .eq("team_id", parsed.data.team_id)
      .eq("role", "member")
    const rows =
      members?.map((m) => ({ task_id: task.id, assignee_id: (m as { id: string }).id })) ?? []
    if (rows.length > 0) {
      const { data: inserted, error: insertErr } = await admin
        .from("task_assignments")
        .insert(rows)
        .select("id")
      if (insertErr) {
        return { ok: false, error: insertErr.message }
      }
      assignedCount = inserted?.length ?? 0
    }
  } else {
    const ids = formData.getAll("assignee_ids").map((v) => String(v)).filter(Boolean)
    if (ids.length === 0) {
      return { ok: false, error: "Select at least one team member." }
    }
    // Verify each id belongs to the chosen team.
    const { data: validMembers } = await admin
      .from("profiles")
      .select("id")
      .eq("team_id", parsed.data.team_id)
      .in("id", ids)
    const validIds = new Set((validMembers ?? []).map((m) => (m as { id: string }).id))
    const rows = ids
      .filter((id) => validIds.has(id))
      .map((id) => ({ task_id: task.id, assignee_id: id }))
    if (rows.length > 0) {
      await admin.from("task_assignments").insert(rows)
      assignedCount = rows.length
    }
  }

  await logActivity({
    actorId: profile.id,
    teamId: parsed.data.team_id,
    action: "task.created",
    entityType: "task",
    entityId: task.id,
    metadata: {
      title: parsed.data.title,
      assigned: assignedCount,
      mode: parsed.data.assign_mode,
    },
  })

  revalidatePath("/dashboard/tasks")
  revalidatePath(`/dashboard/tasks/${task.id}`)
  return { ok: true, taskId: task.id, assignedCount }
}

const AssignSchema = z.object({
  task_id: z.string().uuid(),
  mode: z.enum(["all", "selected"]),
})

/**
 * Re-run assignment on an existing task — useful when new members join the
 * team or when a manager wants to add specific people later.
 */
export async function assignTask(formData: FormData): Promise<TaskActionResult> {
  const profile = await requireRole(["main_admin", "manager"])
  const parsed = AssignSchema.safeParse({
    task_id: formData.get("task_id"),
    mode: formData.get("mode") ?? "all",
  })
  if (!parsed.success) return { ok: false, error: "Invalid input" }

  const supabase = await createClient()
  const { data: task } = await supabase
    .from("tasks")
    .select("id, team_id")
    .eq("id", parsed.data.task_id)
    .maybeSingle()
  if (!task) return { ok: false, error: "Task not found." }
  if (!canManageTeam(profile, task.team_id)) {
    return { ok: false, error: "Not authorised for this task's team." }
  }

  const admin = createAdminClient()
  let added = 0
  if (parsed.data.mode === "all") {
    const { data: count } = await admin.rpc("assign_task_to_team", {
      p_task_id: task.id,
      p_team_id: task.team_id,
    })
    added = typeof count === "number" ? count : 0
  } else {
    const ids = formData.getAll("assignee_ids").map((v) => String(v)).filter(Boolean)
    if (ids.length === 0) return { ok: false, error: "Select at least one member." }
    const rows = ids.map((id) => ({ task_id: task.id, assignee_id: id }))
    await admin.from("task_assignments").upsert(rows, {
      onConflict: "task_id,assignee_id",
      ignoreDuplicates: true,
    })
    added = ids.length
  }

  await logActivity({
    actorId: profile.id,
    teamId: task.team_id,
    action: "task.assigned",
    entityType: "task",
    entityId: task.id,
    metadata: { added, mode: parsed.data.mode },
  })

  revalidatePath(`/dashboard/tasks/${task.id}`)
  revalidatePath("/dashboard/tasks")
  return { ok: true, taskId: task.id, assignedCount: added }
}

const DeleteSchema = z.object({ id: z.string().uuid() })

export async function deleteTask(formData: FormData): Promise<TaskActionResult> {
  const profile = await requireRole(["main_admin", "manager"])
  const parsed = DeleteSchema.safeParse({ id: formData.get("id") })
  if (!parsed.success) return { ok: false, error: "Invalid id" }

  const supabase = await createClient()
  const { data: task } = await supabase
    .from("tasks")
    .select("id, team_id")
    .eq("id", parsed.data.id)
    .maybeSingle()
  if (!task) return { ok: false, error: "Task not found." }
  if (!canManageTeam(profile, task.team_id)) {
    return { ok: false, error: "Not authorised." }
  }

  const { error } = await supabase.from("tasks").delete().eq("id", task.id)
  if (error) return { ok: false, error: error.message }

  await logActivity({
    actorId: profile.id,
    teamId: task.team_id,
    action: "task.deleted",
    entityType: "task",
    entityId: task.id,
  })

  revalidatePath("/dashboard/tasks")
  return { ok: true }
}
