"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireProfile } from "@/lib/auth"
import { AccessDeniedError, assertCapability, CAPABILITIES } from "@/lib/permissions"
import { logActivity } from "@/lib/activity"
import { indexDocument, deleteIndexed, joinContent } from "@/lib/smart-ai/indexer"
import { del } from "@/lib/r2"

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
  due_at: z.string().min(1, "Deadline is required"),
  allow_late: z.coerce.boolean().default(true),
  late_submission_deadline: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  require_late_reason: z.coerce.boolean().default(true),
  // "all" assigns to every member of the team; otherwise a comma-separated
  // list of profile UUIDs (multiple <input name="assignee_ids">).
  assign_mode: z.enum(["all", "selected"]).default("all"),
  // Explicit rule IDs to run. null = use all enabled team rules.
  rule_ids: z.array(z.string().uuid()).nullable().default(null),
}).superRefine((data, ctx) => {
  if (data.allow_late && !data.late_submission_deadline) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Late submission deadline is required when late submissions are allowed.",
      path: ["late_submission_deadline"],
    })
  }
  if (data.due_at && data.late_submission_deadline) {
    if (new Date(data.late_submission_deadline) <= new Date(data.due_at)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Late submission deadline must be after the main deadline.",
        path: ["late_submission_deadline"],
      })
    }
  }
})

/**
 * Create a task and (optionally) bulk-assign it. Managers can only create for
 * their own team; main_admin can target any team. The function uses the
 * service-role client for bulk assignment to bypass RLS efficiently after the
 * caller's role has been verified.
 */
export async function createTask(formData: FormData): Promise<TaskActionResult> {
  const profile = await requireProfile()

  // Collect rule_ids from the form — multiple checkboxes named "rule_ids".
  const rawRuleIds = formData.getAll("rule_ids").map((v) => String(v)).filter(Boolean)

  const parsed = CreateTaskSchema.safeParse({
    team_id: formData.get("team_id") || undefined,
    title: formData.get("title") || "",
    description: formData.get("description") ?? "",
    instructions: formData.get("instructions") ?? "",
    due_at: formData.get("due_at") ?? "",
    allow_late: formData.get("allow_late") === "on" || formData.get("allow_late") === "true",
    late_submission_deadline: formData.get("late_submission_deadline") ?? "",
    require_late_reason:
      formData.get("require_late_reason") === "on" ||
      formData.get("require_late_reason") === "true",
    assign_mode: formData.get("assign_mode") ?? "all",
    // If the form sent the "rules_section_shown" flag but no rule_ids, treat
    // as an intentional empty selection (skip all standing rules).
    // If the section wasn't rendered at all, default to null (all rules).
    rule_ids:
      formData.get("rules_section_shown") === "1"
        ? rawRuleIds.length > 0 ? rawRuleIds : []
        : null,
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  try {
    await assertCapability(profile, CAPABILITIES.TASKS_CREATE, {
      team_id: parsed.data.team_id,
      is_global: false,
    })
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      return { ok: false, error: "You do not have permission to create tasks for this team." }
    }
    throw err
  }

  const admin = createAdminClient()
  const { data: task, error: insertErr } = await admin
    .from("tasks")
    .insert({
      team_id: parsed.data.team_id,
      manager_id: profile.id,
      title: parsed.data.title,
      description: parsed.data.description || null,
      instructions: parsed.data.instructions || null,
      due_at: parsed.data.due_at,
      allow_late: parsed.data.allow_late,
      late_submission_deadline: parsed.data.late_submission_deadline,
      require_late_reason: parsed.data.require_late_reason,
      rule_ids: parsed.data.rule_ids,
    })
    .select("id")
    .single()

  if (insertErr || !task) {
    return { ok: false, error: insertErr?.message ?? "Could not create task." }
  }

  // ---------- Assignments ----------
  let assignedCount = 0

  if (parsed.data.assign_mode === "all") {
    const { data: members } = await admin
      .from("profiles")
      .select("id")
      .eq("team_id", parsed.data.team_id)
      .is("deleted_at", null)
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
      .is("deleted_at", null)
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

  void indexDocument({
    source_type: "task",
    source_id: task.id,
    team_id: parsed.data.team_id,
    owner_id: profile.id,
    title: parsed.data.title,
    content: joinContent([
      parsed.data.title,
      parsed.data.description ?? null,
      parsed.data.instructions ?? null,
      parsed.data.due_at ? `Deadline: ${parsed.data.due_at}` : null,
    ]),
    metadata: {
      due_at: parsed.data.due_at,
      allow_late: parsed.data.allow_late,
      assigned_count: assignedCount,
    },
  })

  revalidatePath("/dashboard/tasks")
  revalidatePath(`/dashboard/tasks/${task.id}`)
  return { ok: true, taskId: task.id, assignedCount }
}

const UpdateTaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(2, "Title is too short").max(200),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  instructions: z.string().trim().max(8000).optional().or(z.literal("")),
  due_at: z.string().min(1, "Deadline is required"),
  allow_late: z.coerce.boolean().default(true),
  late_submission_deadline: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  require_late_reason: z.coerce.boolean().default(true),
  rule_ids: z.array(z.string().uuid()).nullable().default(null),
}).superRefine((data, ctx) => {
  if (data.allow_late && !data.late_submission_deadline) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Late submission deadline is required when late submissions are allowed.",
      path: ["late_submission_deadline"],
    })
  }
  if (data.due_at && data.late_submission_deadline) {
    if (new Date(data.late_submission_deadline) <= new Date(data.due_at)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Late submission deadline must be after the main deadline.",
        path: ["late_submission_deadline"],
      })
    }
  }
})

export async function updateTask(formData: FormData): Promise<TaskActionResult> {
  const profile = await requireProfile()

  const rawRuleIds = formData.getAll("rule_ids").map((v) => String(v)).filter(Boolean)

  const parsed = UpdateTaskSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title") || "",
    description: formData.get("description") ?? "",
    instructions: formData.get("instructions") ?? "",
    due_at: formData.get("due_at") ?? "",
    allow_late: formData.get("allow_late") === "on" || formData.get("allow_late") === "true",
    late_submission_deadline: formData.get("late_submission_deadline") ?? "",
    require_late_reason:
      formData.get("require_late_reason") === "on" ||
      formData.get("require_late_reason") === "true",
    rule_ids:
      formData.get("rules_section_shown") === "1"
        ? rawRuleIds.length > 0 ? rawRuleIds : []
        : null,
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const admin = createAdminClient()
  const { data: task } = await admin
    .from("tasks")
    .select("id, team_id")
    .eq("id", parsed.data.id)
    .maybeSingle()
  if (!task) return { ok: false, error: "Task not found." }

  try {
    await assertCapability(profile, CAPABILITIES.TASKS_UPDATE, {
      team_id: task.team_id,
      is_global: false,
    })
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      return { ok: false, error: "You do not have permission to edit this task." }
    }
    throw err
  }

  const { error: updateErr } = await admin
    .from("tasks")
    .update({
      title: parsed.data.title,
      description: parsed.data.description || null,
      instructions: parsed.data.instructions || null,
      due_at: parsed.data.due_at,
      allow_late: parsed.data.allow_late,
      late_submission_deadline: parsed.data.late_submission_deadline,
      require_late_reason: parsed.data.require_late_reason,
      rule_ids: parsed.data.rule_ids,
    })
    .eq("id", task.id)
  if (updateErr) return { ok: false, error: updateErr.message }

  await logActivity({
    actorId: profile.id,
    teamId: task.team_id,
    action: "task.updated",
    entityType: "task",
    entityId: task.id,
    metadata: { title: parsed.data.title },
  })

  void indexDocument({
    source_type: "task",
    source_id: task.id,
    team_id: task.team_id,
    owner_id: profile.id,
    title: parsed.data.title,
    content: joinContent([
      parsed.data.title,
      parsed.data.description ?? null,
      parsed.data.instructions ?? null,
      parsed.data.due_at ? `Deadline: ${parsed.data.due_at}` : null,
    ]),
    metadata: {
      due_at: parsed.data.due_at,
      allow_late: parsed.data.allow_late,
    },
  })

  revalidatePath("/dashboard/tasks")
  revalidatePath(`/dashboard/tasks/${task.id}`)
  return { ok: true, taskId: task.id }
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
  const profile = await requireProfile()
  const parsed = AssignSchema.safeParse({
    task_id: formData.get("task_id"),
    mode: formData.get("mode") ?? "all",
  })
  if (!parsed.success) return { ok: false, error: "Invalid input" }

  const admin = createAdminClient()
  const { data: task } = await admin
    .from("tasks")
    .select("id, team_id")
    .eq("id", parsed.data.task_id)
    .maybeSingle()
  if (!task) return { ok: false, error: "Task not found." }

  try {
    await assertCapability(profile, CAPABILITIES.TASKS_ASSIGN, {
      team_id: task.team_id,
      is_global: false,
    })
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      return { ok: false, error: "You do not have permission to assign this task." }
    }
    throw err
  }

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

    // Defense in depth: confirm every supplied profile id actually belongs to
    // THIS task's team before inserting. Prevents an authenticated manager
    // from spraying assignments across other teams by spoofing the form.
    const { data: validMembers } = await admin
      .from("profiles")
      .select("id")
      .eq("team_id", task.team_id)
      .is("deleted_at", null)
      .in("id", ids)
    const validIds = new Set((validMembers ?? []).map((m) => (m as { id: string }).id))
    const rows = ids
      .filter((id) => validIds.has(id))
      .map((id) => ({ task_id: task.id, assignee_id: id }))
    if (rows.length === 0) {
      return { ok: false, error: "None of the selected members belong to this task's team." }
    }
    await admin.from("task_assignments").upsert(rows, {
      onConflict: "task_id,assignee_id",
      ignoreDuplicates: true,
    })
    added = rows.length
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
const BulkDeleteSchema = z.object({ ids: z.array(z.string().uuid()).min(1) })

async function deleteSubmissionsForTasks(
  admin: ReturnType<typeof createAdminClient>,
  taskIds: string[],
): Promise<void> {
  if (taskIds.length === 0) return

  const { data: subs } = await admin
    .from("submissions")
    .select("id, blob_url, team_id")
    .in("task_id", taskIds)

  if (!subs || subs.length === 0) return

  const subIds = subs.map((s) => s.id)

  await admin.from("submissions").delete().in("id", subIds)

  await Promise.allSettled(
    subs.map((s) =>
      (s as { id: string; blob_url: string | null; team_id: string }).blob_url
        ? del((s as { id: string; blob_url: string; team_id: string }).blob_url).catch((err) =>
            console.error("[tasks] submission blob delete failed", err),
          )
        : Promise.resolve(),
    ),
  )

  void Promise.all(
    subIds.map((id) => deleteIndexed({ source_type: "submission", source_id: id })),
  )
}

export async function bulkDeleteTasks(ids: string[]): Promise<TaskActionResult> {
  const profile = await requireProfile()
  const parsed = BulkDeleteSchema.safeParse({ ids })
  if (!parsed.success) return { ok: false, error: "Invalid task IDs" }

  const admin = createAdminClient()
  const { data: tasks } = await admin
    .from("tasks")
    .select("id, team_id")
    .in("id", parsed.data.ids)
  if (!tasks || tasks.length === 0) return { ok: false, error: "No tasks found." }

  // Verify permission for each unique team represented
  const uniqueTeamIds = [...new Set(tasks.map((t) => (t as { id: string; team_id: string }).team_id))]
  for (const teamId of uniqueTeamIds) {
    try {
      await assertCapability(profile, CAPABILITIES.TASKS_DELETE, {
        team_id: teamId,
        is_global: false,
      })
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        return { ok: false, error: "You do not have permission to delete one or more of these tasks." }
      }
      throw err
    }
  }

  const validIds = tasks.map((t) => (t as { id: string; team_id: string }).id)

  await deleteSubmissionsForTasks(admin, validIds)

  const { error } = await admin.from("tasks").delete().in("id", validIds)
  if (error) return { ok: false, error: error.message }

  for (const task of tasks as { id: string; team_id: string }[]) {
    await logActivity({
      actorId: profile.id,
      teamId: task.team_id,
      action: "task.deleted",
      entityType: "task",
      entityId: task.id,
    })
    void deleteIndexed({ source_type: "task", source_id: task.id })
    revalidatePath(`/dashboard/tasks/${task.id}`)
  }

  revalidatePath("/dashboard/tasks")
  return { ok: true }
}

export async function deleteTask(formData: FormData): Promise<TaskActionResult> {
  const profile = await requireProfile()
  const parsed = DeleteSchema.safeParse({ id: formData.get("id") })
  if (!parsed.success) return { ok: false, error: "Invalid id" }

  const admin = createAdminClient()
  const { data: task } = await admin
    .from("tasks")
    .select("id, team_id")
    .eq("id", parsed.data.id)
    .maybeSingle()
  if (!task) return { ok: false, error: "Task not found." }

  try {
    await assertCapability(profile, CAPABILITIES.TASKS_DELETE, {
      team_id: task.team_id,
      is_global: false,
    })
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      return { ok: false, error: "You do not have permission to delete this task." }
    }
    throw err
  }

  await deleteSubmissionsForTasks(admin, [task.id])

  const { error } = await admin.from("tasks").delete().eq("id", task.id)
  if (error) return { ok: false, error: error.message }

  await logActivity({
    actorId: profile.id,
    teamId: task.team_id,
    action: "task.deleted",
    entityType: "task",
    entityId: task.id,
  })

  void deleteIndexed({ source_type: "task", source_id: task.id })

  revalidatePath(`/dashboard/tasks/${task.id}`)
  revalidatePath("/dashboard/tasks")
  return { ok: true }
}
