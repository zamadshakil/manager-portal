import { loadEnvConfig } from "@next/env"
import { createClient } from "@supabase/supabase-js"

loadEnvConfig(process.cwd())

const REQUIRED_CONFIRMATION = "provision-isolated-showcase-guests"
if (process.env.SHOWCASE_PROVISION_CONFIRM !== REQUIRED_CONFIRMATION) {
  throw new Error(
    `Refusing to provision. Set SHOWCASE_PROVISION_CONFIRM=${REQUIRED_CONFIRMATION} for the intended preview database.`,
  )
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const managerEmail = process.env.SHOWCASE_GUEST_MANAGER_EMAIL?.trim().toLowerCase()
const managerPassword = process.env.SHOWCASE_GUEST_MANAGER_PASSWORD
const memberEmail = process.env.SHOWCASE_GUEST_MEMBER_EMAIL?.trim().toLowerCase()
const memberPassword = process.env.SHOWCASE_GUEST_MEMBER_PASSWORD

const required = {
  NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
  SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  SHOWCASE_GUEST_MANAGER_EMAIL: managerEmail,
  SHOWCASE_GUEST_MANAGER_PASSWORD: managerPassword,
  SHOWCASE_GUEST_MEMBER_EMAIL: memberEmail,
  SHOWCASE_GUEST_MEMBER_PASSWORD: memberPassword,
}
const missing = Object.entries(required).filter(([, value]) => !value).map(([name]) => name)
if (missing.length) throw new Error(`Missing required variables: ${missing.join(", ")}`)
if (managerEmail === memberEmail) throw new Error("Showcase guest emails must be different")

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function unwrap(label, promise) {
  const { data, error } = await promise
  if (error) throw new Error(`${label}: ${error.message}`)
  return data
}

async function findAuthUser(email) {
  for (let page = 1; page <= 20; page += 1) {
    const data = await unwrap("List auth users", admin.auth.admin.listUsers({ page, perPage: 100 }))
    const found = data.users.find((user) => user.email?.toLowerCase() === email)
    if (found) return found
    if (data.users.length < 100) return null
  }
  throw new Error("Showcase user lookup exceeded 2,000 auth users")
}

async function ensureUser({ email, password, fullName, role, teamId, managerId = null }) {
  let user = await findAuthUser(email)
  if (!user) {
    const data = await unwrap(
      `Create ${role} guest`,
      admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, role, team_id: teamId, must_reset: false, showcase: true },
      }),
    )
    user = data.user
  } else {
    const data = await unwrap(
      `Refresh ${role} guest credentials`,
      admin.auth.admin.updateUserById(user.id, {
        password,
        email_confirm: true,
        user_metadata: { ...user.user_metadata, full_name: fullName, role, team_id: teamId, must_reset: false, showcase: true },
      }),
    )
    user = data.user
  }

  await unwrap(
    `Upsert ${role} profile`,
    admin.from("profiles").upsert({
      id: user.id,
      email,
      full_name: fullName,
      role,
      team_id: teamId,
      manager_id: managerId,
      must_reset: false,
      deleted_at: null,
    }, { onConflict: "id" }),
  )
  return user
}

const teamName = "Hierarchia Showcase"
let team = await unwrap(
  "Find showcase team",
  admin.from("teams").select("id, manager_id").eq("name", teamName).maybeSingle(),
)
if (!team) {
  team = await unwrap(
    "Create showcase team",
    admin.from("teams").insert({
      name: teamName,
      description: "Isolated guest workspace for product demonstrations.",
      settings: { showcase: true },
    }).select("id, manager_id").single(),
  )
}

const manager = await ensureUser({
  email: managerEmail,
  password: managerPassword,
  fullName: "Alex Morgan (Guest Manager)",
  role: "manager",
  teamId: team.id,
})
const member = await ensureUser({
  email: memberEmail,
  password: memberPassword,
  fullName: "Jordan Lee (Guest Member)",
  role: "member",
  teamId: team.id,
  managerId: manager.id,
})

await unwrap(
  "Assign showcase manager",
  admin.from("teams").update({ manager_id: manager.id }).eq("id", team.id),
)

const existingTasks = await unwrap(
  "Read showcase tasks",
  admin.from("tasks").select("id, title").eq("team_id", team.id).like("title", "Showcase:%"),
)
const taskByTitle = new Map(existingTasks.map((task) => [task.title, task]))
const now = Date.now()
const taskSpecs = [
  { title: "Showcase: Q3 operations brief", description: "Prepare a concise quarterly operations update.", due_at: new Date(now + 5 * 86400000).toISOString() },
  { title: "Showcase: Customer insight summary", description: "Summarize recurring feedback and proposed actions.", due_at: new Date(now + 9 * 86400000).toISOString() },
  { title: "Showcase: Inventory exception review", description: "Review exceptions and flag urgent follow-ups.", due_at: new Date(now + 14 * 86400000).toISOString() },
]

for (const spec of taskSpecs) {
  if (taskByTitle.has(spec.title)) continue
  const task = await unwrap(
    `Create ${spec.title}`,
    admin.from("tasks").insert({
      team_id: team.id,
      manager_id: manager.id,
      title: spec.title,
      description: spec.description,
      instructions: "Use clear headings, concise findings, and actionable recommendations.",
      due_at: spec.due_at,
      allow_late: true,
      require_late_reason: false,
    }).select("id, title").single(),
  )
  taskByTitle.set(task.title, task)
}

const tasks = [...taskByTitle.values()]
const existingAssignments = await unwrap(
  "Read showcase assignments",
  admin.from("task_assignments").select("id, task_id, submission_id").eq("assignee_id", member.id),
)
const assignmentByTask = new Map(existingAssignments.map((row) => [row.task_id, row]))
for (const task of tasks) {
  if (assignmentByTask.has(task.id)) continue
  const assignment = await unwrap(
    `Assign ${task.title}`,
    admin.from("task_assignments").insert({ task_id: task.id, assignee_id: member.id }).select("id, task_id, submission_id").single(),
  )
  assignmentByTask.set(task.id, assignment)
}

const existingSubmissions = await unwrap(
  "Read showcase submissions",
  admin.from("submissions").select("id, title, task_assignment_id").eq("team_id", team.id).like("title", "Showcase:%"),
)
const submissionByTitle = new Map(existingSubmissions.map((row) => [row.title, row]))
const submissionSpecs = [
  { title: "Showcase: Operations brief — approved", status: "passed", score: 94, summary: "Clear metrics, ownership, and next steps." },
  { title: "Showcase: Customer insights — review", status: "needs_review", score: 78, summary: "Strong themes; two source citations need verification." },
]

for (let index = 0; index < submissionSpecs.length; index += 1) {
  const spec = submissionSpecs[index]
  if (submissionByTitle.has(spec.title) || !tasks[index]) continue
  const assignment = assignmentByTask.get(tasks[index].id)
  const submission = await unwrap(
    `Create ${spec.title}`,
    admin.from("submissions").insert({
      uploader_id: member.id,
      team_id: team.id,
      title: spec.title,
      blob_url: "https://example.com/showcase-document.pdf",
      mime_type: "application/pdf",
      size_bytes: 245760,
      status: spec.status,
      score: spec.score,
      summary: spec.summary,
      flags: [],
      metadata: { showcase: true },
      task_id: tasks[index].id,
      task_assignment_id: assignment?.id ?? null,
      submitted_at: new Date(now - (index + 1) * 86400000).toISOString(),
    }).select("id, title, task_assignment_id").single(),
  )
  submissionByTitle.set(submission.title, submission)
  if (assignment) {
    await unwrap(
      `Complete assignment for ${spec.title}`,
      admin.from("task_assignments").update({
        status: "submitted",
        submission_id: submission.id,
        submitted_at: new Date(now - (index + 1) * 86400000).toISOString(),
      }).eq("id", assignment.id),
    )
  }
}

const existingAnnouncements = await unwrap(
  "Read showcase announcements",
  admin.from("announcements").select("title").eq("team_id", team.id).like("title", "Showcase:%"),
)
if (!existingAnnouncements.some((row) => row.title === "Showcase: Welcome to the workspace")) {
  await unwrap(
    "Create showcase announcement",
    admin.from("announcements").insert({
      author_id: manager.id,
      team_id: team.id,
      title: "Showcase: Welcome to the workspace",
      body: "Explore tasks, submissions, announcements, reports, and team collaboration using this isolated guest workspace.",
      priority: "high",
    }),
  )
}

const existingMaterials = await unwrap(
  "Read showcase materials",
  admin.from("materials").select("title").eq("team_id", team.id).like("title", "Showcase:%"),
)
if (!existingMaterials.some((row) => row.title === "Showcase: Team handbook")) {
  await unwrap(
    "Create showcase material",
    admin.from("materials").insert({
      author_id: manager.id,
      team_id: team.id,
      title: "Showcase: Team handbook",
      description: "A sample resource illustrating the shared materials library.",
      blob_url: "https://example.com/showcase-handbook.pdf",
      file_type: "application/pdf",
      size_bytes: 524288,
      tags: ["showcase", "handbook"],
    }),
  )
}

console.log(JSON.stringify({
  ok: true,
  team: { id: team.id, name: teamName },
  users: [
    { id: manager.id, email: managerEmail, role: "manager" },
    { id: member.id, email: memberEmail, role: "member" },
  ],
  seeded: { tasks: tasks.length, submissions: submissionByTitle.size },
}, null, 2))
