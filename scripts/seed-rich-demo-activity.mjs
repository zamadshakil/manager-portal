import pg from "pg"

const dbUrl = "postgres://postgres.nnqchugcpwqkyghpajrf:GFQQDf0qtbpbeEET@aws-0-us-east-1.pooler.supabase.com:6543/postgres"
const { Client } = pg
const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

async function run() {
  await db.connect()
  console.log("Connected to DB...")

  // Get users
  const { rows: profiles } = await db.query("SELECT id, email, full_name, role FROM public.profiles")
  const admin = profiles.find(p => p.email === "admin@zamdevai.com")
  const manager = profiles.find(p => p.email === "manager@zamdevai.com")
  const member = profiles.find(p => p.email === "member@zamdevai.com")

  if (!admin || !manager || !member) {
    throw new Error("Missing one of the demo users (admin, manager, member)")
  }

  // Get Operations team
  const { rows: teams } = await db.query("SELECT id FROM public.teams WHERE name = 'Operations' LIMIT 1")
  const teamId = teams[0]?.id

  // Get some tasks to link
  const { rows: tasks } = await db.query("SELECT id, title FROM public.tasks LIMIT 4")
  const t1 = tasks[0]?.id
  const t2 = tasks[1]?.id
  const t3 = tasks[2]?.id
  const t4 = tasks[3]?.id

  // Get validation rules
  const { rows: rules } = await db.query("SELECT id, rule_name FROM public.validation_rules LIMIT 3")
  const r1 = rules[0]?.id
  const r2 = rules[1]?.id

  console.log("Cleaning old demo submissions, announcements, materials, and messages...")
  await db.query("DELETE FROM public.validation_runs WHERE true")
  await db.query("DELETE FROM public.submissions WHERE true")
  await db.query("DELETE FROM public.announcements WHERE true")
  await db.query("DELETE FROM public.materials WHERE true")
  await db.query("DELETE FROM public.messages WHERE true")
  await db.query("DELETE FROM public.conversation_members WHERE true")
  await db.query("DELETE FROM public.conversations WHERE true")

  console.log("1. Seeding Submissions & AI Validation Runs...")
  const subs = [
    {
      title: "North Facility HVAC Inspection Report",
      status: "passed",
      score: 94.5,
      summary: "All mandatory safety checks verified. High technical consistency across thermal load metrics. Verified zero building code violations.",
      flags: [],
      taskId: t1,
      createdAt: new Date(Date.now() - 3600 * 1000 * 5)
    },
    {
      title: "Q3 Field Operations Equipment Audit",
      status: "passed",
      score: 88.0,
      summary: "Document matches field compliance rules. Equipment serial numbers match dispatch inventory logs with verified calibration certificates.",
      flags: [],
      taskId: t2,
      createdAt: new Date(Date.now() - 3600 * 1000 * 24)
    },
    {
      title: "Field Operations Risk Assessment Log",
      status: "needs_review",
      score: 64.0,
      summary: "Draft contains incomplete mitigation schedule for high-voltage zone. Supervisor sign-off recommended before commissioning.",
      flags: [{ severity: "warn", message: "High-voltage section requires secondary verification" }],
      taskId: t3,
      createdAt: new Date(Date.now() - 3600 * 1000 * 48)
    },
    {
      title: "Emergency Generator Maintenance Record",
      status: "failed",
      score: 38.0,
      summary: "Failed required completeness check. Missing fuel pressure measurements and required technician certification stamp.",
      flags: [{ severity: "fail", message: "Missing technician certification stamp" }],
      taskId: t4,
      createdAt: new Date(Date.now() - 3600 * 1000 * 72)
    }
  ]

  for (const s of subs) {
    const { rows } = await db.query(`
      INSERT INTO public.submissions (
        uploader_id, team_id, task_id, title, blob_url, blob_pathname,
        mime_type, size_bytes, status, score, summary, flags, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
      RETURNING id
    `, [
      member.id, teamId, s.taskId, s.title,
      `https://demo.zamdevai.com/docs/${s.title.toLowerCase().replace(/[^a-z0-9]/g, "-")}.pdf`,
      `demo/${s.title.toLowerCase().replace(/[^a-z0-9]/g, "-")}.pdf`,
      "application/pdf", 145000 + Math.floor(Math.random() * 80000),
      s.status, s.score, s.summary, JSON.stringify(s.flags), s.createdAt
    ])

    const subId = rows[0].id

    // Add validation run records
    if (r1) {
      await db.query(`
        INSERT INTO public.validation_runs (
          submission_id, rule_id, model, pass, score, reasons, flags, latency_ms, tokens_in, tokens_out, created_at
        ) VALUES ($1, $2, 'gemini-2.0-flash', $3, $4, $5, $6, 1240, 850, 140, $7)
      `, [
        subId, r1, s.score >= 70, s.score,
        JSON.stringify(["Structure conforms to specification", "Key milestones present"]),
        JSON.stringify(s.flags), s.createdAt
      ])
    }
  }
  console.log("✅ Seeded 4 submissions with AI validation runs")

  console.log("2. Seeding Announcements...")
  await db.query(`
    INSERT INTO public.announcements (team_id, author_id, title, body, priority, created_at)
    VALUES
      ($1, $2, '🚨 Q3 Site Safety & Inspection Standards Updated', 'All field personnel are required to review the new OSHA 2026 protocols before conducting next week inspections. Make sure to capture high-res photographic evidence for all mechanical checks.', 'urgent', now() - interval '2 days'),
      ($1, $3, '📋 Automated AI Verification Now Live on Submissions', 'Field reports are now automatically scanned by the Hierarchia AI pipeline within 10 seconds of upload. Check your validation scores and follow-up flags in the Submissions tab.', 'high', now() - interval '1 day'),
      (null, $2, '🎉 Welcome to Hierarchia Operations Workspace', 'Welcome to the unified operations and workforce management portal. Review dispatched tasks, check team updates, and communicate directly in the Messages module.', 'normal', now() - interval '4 hours')
  `, [teamId, admin.id, manager.id])
  console.log("✅ Seeded 3 announcements")

  console.log("3. Seeding Materials...")
  await db.query(`
    INSERT INTO public.materials (team_id, author_id, title, description, blob_url, blob_pathname, file_type, size_bytes, created_at)
    VALUES
      ($1, $2, 'Standard Operating Procedure (SOP) — Field Inspection v2.4', 'Official SOP covering pre-site checklists, hazard assessments, and client sign-off procedures.', 'https://demo.zamdevai.com/materials/sop-v2.4.pdf', 'materials/sop-v2.4.pdf', 'application/pdf', 524000, now() - interval '3 days'),
      ($1, $3, 'OSHA Field Compliance Protocols 2026', 'Federal and state safety guidelines for commercial facility audits and electrical inspections.', 'https://demo.zamdevai.com/materials/osha-compliance-2026.pdf', 'materials/osha-compliance-2026.pdf', 'application/pdf', 1024000, now() - interval '2 days'),
      ($1, $2, 'Equipment Safety & Calibration Checklist', 'Mandatory calibration log sheet for HVAC testing gauges and pressure sensors.', 'https://demo.zamdevai.com/materials/calibration-checklist.pdf', 'materials/calibration-checklist.pdf', 'application/pdf', 214000, now() - interval '1 day')
  `, [teamId, admin.id, manager.id])
  console.log("✅ Seeded 3 materials")

  console.log("4. Seeding Messages & Conversations...")
  // Create Operations Team group conversation
  const { rows: convRows } = await db.query(`
    INSERT INTO public.conversations (type, name, created_by, created_at, updated_at)
    VALUES ('group', 'Operations Team', $1, now() - interval '1 day', now())
    RETURNING id
  `, [manager.id])
  const groupConvId = convRows[0].id

  // Add members to conversation
  await db.query(`
    INSERT INTO public.conversation_members (conversation_id, user_id, role, joined_at)
    VALUES
      ($1, $2, 'admin', now() - interval '1 day'),
      ($1, $3, 'admin', now() - interval '1 day'),
      ($1, $4, 'member', now() - interval '1 day')
  `, [groupConvId, admin.id, manager.id, member.id])

  // Add messages
  await db.query(`
    INSERT INTO public.messages (conversation_id, sender_id, content, created_at)
    VALUES
      ($1, $2, 'Welcome to the Operations channel team. Let us keep daily field updates here.', now() - interval '10 hours'),
      ($1, $3, 'Uploaded the North Facility HVAC report earlier. Waiting for final AI pass.', now() - interval '4 hours'),
      ($1, $2, 'Just verified it — AI gave it a 94.5 score! Clean pass, approved for dispatch.', now() - interval '2 hours'),
      ($1, $4, 'Great work Alex! Outstanding accuracy on the thermal load data.', now() - interval '1 hour')
  `, [groupConvId, manager.id, member.id, admin.id])

  // Create 1-on-1 DM conversation between Manager and Member
  const { rows: dmRows } = await db.query(`
    INSERT INTO public.conversations (type, name, created_by, created_at, updated_at)
    VALUES ('dm', null, $1, now() - interval '5 hours', now())
    RETURNING id
  `, [manager.id])
  const dmConvId = dmRows[0].id

  await db.query(`
    INSERT INTO public.conversation_members (conversation_id, user_id, role, joined_at)
    VALUES
      ($1, $2, 'member', now() - interval '5 hours'),
      ($1, $3, 'member', now() - interval '5 hours')
  `, [dmConvId, manager.id, member.id])

  await db.query(`
    INSERT INTO public.messages (conversation_id, sender_id, content, created_at)
    VALUES
      ($1, $2, 'Hey Alex, quick heads up: the Risk Assessment draft needs a secondary high-voltage sign-off before closing.', now() - interval '3 hours'),
      ($1, $3, 'Thanks Sarah! I am updating the schedule section now and will re-upload before 5 PM.', now() - interval '1 hour')
  `, [dmConvId, manager.id, member.id])

  console.log("✅ Seeded conversations and messages")

  // Log activities
  await db.query(`
    INSERT INTO public.activity_log (actor_id, team_id, action, entity_type, entity_id, metadata, created_at)
    VALUES
      ($1, $4, 'task.create', 'task', $5, '{"title": "Quarterly Report Submission"}'::jsonb, now() - interval '6 hours'),
      ($2, $4, 'submission.create', 'submission', (SELECT id FROM public.submissions LIMIT 1), '{"title": "North Facility HVAC Inspection Report"}'::jsonb, now() - interval '5 hours'),
      ($3, $4, 'submission.review', 'submission', (SELECT id FROM public.submissions LIMIT 1), '{"score": 94.5, "status": "passed"}'::jsonb, now() - interval '2 hours')
  `, [manager.id, member.id, admin.id, teamId, t1])

  console.log("🎉 ALL DEMO ACTIVITIES SEEDED SUCCESSFULLY!")
  await db.end()
}

run().catch(console.error)
