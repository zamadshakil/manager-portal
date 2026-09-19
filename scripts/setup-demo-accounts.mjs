import { createClient } from "@supabase/supabase-js"
import pg from "pg"

const supabaseUrl = "https://nnqchugcpwqkyghpajrf.supabase.co"
const serviceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ucWNodWdjcHdxa3lnaHBhanJmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4OTc2ODE5NywiZXhwIjoyMTA1MzQ0MTk3fQ.m62z0TgzIinG7DSRvR-RRg28TzSxFFlWE_6AE5bKAS0"
const dbUrl = "postgres://postgres.nnqchugcpwqkyghpajrf:GFQQDf0qtbpbeEET@aws-0-us-east-1.pooler.supabase.com:6543/postgres"

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})

const { Client } = pg
const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

const DEMO_PASSWORD = "DemoPassword123!"

async function run() {
  await db.connect()
  console.log("Connected to DB & Supabase Auth...")

  // Get Operations team
  const { rows: teamRows } = await db.query("SELECT id FROM public.teams WHERE name = 'Operations' LIMIT 1")
  const teamId = teamRows[0]?.id
  console.log("Operations team ID:", teamId)

  // 1. Ensure Super Admin password is set to DEMO_PASSWORD
  const { data: { users }, error: listErr } = await supabase.auth.admin.listUsers()
  if (listErr) throw listErr

  let adminUser = users.find(u => u.email === "admin@zamdevai.com")
  if (adminUser) {
    await supabase.auth.admin.updateUserById(adminUser.id, {
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { role: "main_admin", full_name: "Zamad Shakeel" }
    })
    console.log("✅ Updated admin@zamdevai.com credentials")
  }

  // 2. Ensure Manager user exists
  let managerUser = users.find(u => u.email === "manager@zamdevai.com")
  if (!managerUser) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: "manager@zamdevai.com",
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { role: "manager", full_name: "Sarah Jenkins" }
    })
    if (error) throw error
    managerUser = data.user
    console.log("✅ Created manager@zamdevai.com")
  } else {
    await supabase.auth.admin.updateUserById(managerUser.id, {
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { role: "manager", full_name: "Sarah Jenkins" }
    })
    console.log("✅ Updated manager@zamdevai.com")
  }

  // 3. Ensure Member user exists
  let memberUser = users.find(u => u.email === "member@zamdevai.com")
  if (!memberUser) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: "member@zamdevai.com",
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { role: "member", full_name: "Alex Rivera" }
    })
    if (error) throw error
    memberUser = data.user
    console.log("✅ Created member@zamdevai.com")
  } else {
    await supabase.auth.admin.updateUserById(memberUser.id, {
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { role: "member", full_name: "Alex Rivera" }
    })
    console.log("✅ Updated member@zamdevai.com")
  }

  // Update Profiles in Postgres directly to ensure roles, teams and managers are assigned
  await db.query(`
    UPDATE public.profiles
    SET role = 'main_admin', full_name = 'Zamad Shakeel (Founder & Admin)'
    WHERE id = $1
  `, [adminUser.id])

  await db.query(`
    UPDATE public.profiles
    SET role = 'manager', team_id = $1, full_name = 'Sarah Jenkins (Ops Manager)'
    WHERE id = $2
  `, [teamId, managerUser.id])

  await db.query(`
    UPDATE public.profiles
    SET role = 'member', team_id = $1, manager_id = $2, full_name = 'Alex Rivera (Field Specialist)'
    WHERE id = $3
  `, [teamId, managerUser.id, memberUser.id])

  // Set Operations team manager
  await db.query(`
    UPDATE public.teams
    SET manager_id = $1
    WHERE id = $2
  `, [managerUser.id, teamId])

  console.log("✅ Updated all profiles and team hierarchy")

  await db.end()
}

run().catch(console.error)
