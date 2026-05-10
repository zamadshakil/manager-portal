/**
 * seed-test-data.mjs
 *
 * Seeds the database with 9 validation rules, 6 tasks, and all task
 * assignments needed for the pre-production testing guide.
 *
 * Usage:
 *   node scripts/seed-test-data.mjs
 *
 * Reads SUPABASE_DB_URL (or DATABASE_URL) from .env.local automatically.
 * Re-running is safe: existing test rows are detected and skipped.
 */

import pg from "pg";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Env loader (same pattern as run-pending-migrations.mjs) ──────────────────
function loadEnvLocal() {
  try {
    const raw = readFileSync(join(__dirname, "../.env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const [, k, vRaw] = m;
      if (process.env[k]) continue;
      process.env[k] = vRaw.replace(/^['"]|['"]$/g, "");
    }
  } catch { /* no .env.local — rely on shell env */ }
}
loadEnvLocal();

const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("❌  Set SUPABASE_DB_URL or DATABASE_URL in .env.local (see .env.local.example).");
  process.exit(1);
}

const pool = new Pool({ connectionString, ssl: false });

// ── Helpers ───────────────────────────────────────────────────────────────────
const now = new Date();
const daysFromNow  = (d) => new Date(now.getTime() + d * 86_400_000).toISOString();
const hoursAgo     = (h) => new Date(now.getTime() - h * 3_600_000).toISOString();

function printSection(title) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(60));
}

// ── Main ──────────────────────────────────────────────────────────────────────
const client = await pool.connect();

try {
  await client.query("BEGIN");

  // ── 1. Discover existing users & teams ─────────────────────────────────────
  printSection("1/5  Discovering existing users and teams");

  const { rows: adminRows } = await client.query(
    `SELECT id, email, full_name FROM public.profiles WHERE role = 'main_admin' LIMIT 1`
  );
  if (!adminRows.length) {
    throw new Error("No main_admin profile found. Create the admin account first.");
  }
  const admin = adminRows[0];
  console.log(`  ✅ main_admin   : ${admin.email} (${admin.id})`);

  const { rows: teamRows } = await client.query(
    `SELECT id, name FROM public.teams ORDER BY created_at LIMIT 1`
  );
  if (!teamRows.length) {
    throw new Error("No teams found. Create at least one team before seeding test data.");
  }
  const team = teamRows[0];
  console.log(`  ✅ team         : "${team.name}" (${team.id})`);

  const { rows: managerRows } = await client.query(
    `SELECT id, email, full_name FROM public.profiles
     WHERE role = 'manager' AND team_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [team.id]
  );
  // Fall back to main_admin as task creator — valid because main_admin can
  // create tasks for any team and acts as de-facto manager for seed purposes.
  const manager = managerRows.length ? managerRows[0] : admin;
  const managerLabel = managerRows.length ? manager.email : `${manager.email} (main_admin acting as manager)`;
  console.log(`  ✅ manager      : ${managerLabel} (${manager.id})`);

  const { rows: memberRows } = await client.query(
    `SELECT id, email, full_name FROM public.profiles
     WHERE role = 'member' AND team_id = $1 AND deleted_at IS NULL
     ORDER BY created_at`,
    [team.id]
  );
  if (!memberRows.length) {
    throw new Error(`No members found in team "${team.name}". Add at least one member first.`);
  }
  console.log(`  ✅ members (${memberRows.length})  : ${memberRows.map(m => m.email).join(", ")}`);
  const firstMember = memberRows[0];

  // ── 2. Guard: skip if test data already exists ──────────────────────────────
  const { rows: existCheck } = await client.query(
    `SELECT id FROM public.validation_rules WHERE rule_name = 'Content Length Check' LIMIT 1`
  );
  if (existCheck.length) {
    console.log("\n⚠️   Test rules already exist (found 'Content Length Check').");
    console.log("    To re-seed, delete existing test rules and tasks first, then re-run.\n");
    await client.query("ROLLBACK");
    await client.end();
    process.exit(0);
  }

  // ── 3. Insert validation rules ──────────────────────────────────────────────
  printSection("2/5  Inserting 9 validation rules");

  async function insertRule({ teamId, name, desc, prompt, threshold, weight, enabled, createdBy }) {
    const { rows } = await client.query(
      `INSERT INTO public.validation_rules
         (team_id, rule_name, description, prompt_template, threshold, weight, enabled, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [teamId ?? null, name, desc, prompt, threshold, weight, enabled, createdBy]
    );
    const id = rows[0].id;
    const scope = teamId ? `team "${team.name}"` : "GLOBAL";
    const status = enabled ? "✅ enabled" : "⛔ disabled";
    console.log(`  ${status}  [${scope}]  "${name}"  threshold=${threshold}  weight=${weight}  → ${id}`);
    return id;
  }

  // R1 — Content Length Check (global, main_admin)
  const r1 = await insertRule({
    teamId: null,
    name: "Content Length Check",
    desc: "Verify the document contains sufficient substantive content for meaningful review.",
    prompt: `Evaluate whether this document contains sufficient content for meaningful analysis.
A document with fewer than 3 paragraphs or less than 200 words should score below 50.
A thin document that is essentially empty or only contains a title/heading should score 0-20.
A well-developed document with multiple paragraphs and clear points should score 70-100.`,
    threshold: 55,
    weight: 1,
    enabled: true,
    createdBy: admin.id,
  });

  // R2 — Professional Language (team, manager)
  const r2 = await insertRule({
    teamId: team.id,
    name: "Professional Language",
    desc: "Checks that the document uses professional, formal business language throughout.",
    prompt: `Evaluate the document for professional language and formal tone.
Deduct points for: slang, casual phrasing, first-person informal voice ("so basically", "a whole thing"), typos, or overly emotional language.
Award high scores for clear, concise, formal business writing.
A document written in casual conversational language with no formal structure should score 0-35.
A professionally written document with minor tone inconsistencies should score 65-80.
A fully formal, polished document should score 85-100.`,
    threshold: 70,
    weight: 1,
    enabled: true,
    createdBy: manager.id,
  });

  // R3 — Required Sections Check (team, manager)
  const r3 = await insertRule({
    teamId: team.id,
    name: "Required Sections Check",
    desc: "Checks for the presence of Introduction, Body/Analysis, and Conclusion sections.",
    prompt: `Check whether the document contains all three required sections:
1. Introduction (or Executive Summary)
2. Main body or Analysis section (e.g. KPI breakdown, findings, challenges)
3. Conclusion or Recommendations

Each clearly present section earns approximately 33 points.
If all three sections are present and well-developed, score 90-100.
If two sections are present, score 55-70.
If only one section is present, score 20-40.
If none of the required sections are identifiable, score 0-15.`,
    threshold: 75,
    weight: 2,
    enabled: true,
    createdBy: manager.id,
  });

  // R4 — Strict Formatting Standard (global, main_admin)
  const r4 = await insertRule({
    teamId: null,
    name: "Strict Formatting Standard",
    desc: "Enforces a very high formatting bar — numbered sections, consistent headings, page structure.",
    prompt: `Evaluate formatting quality strictly. The document MUST have:
- Numbered or clearly titled sections with consistent heading hierarchy
- No walls of unbroken text (paragraphs must be separated)
- No mix of bullet styles or inconsistent list formatting
- Professional layout: title, dated, structured body

Scoring:
- All formatting requirements met with no violations: 92-100
- Minor inconsistencies (1-2 issues): 75-89 (FAILS — below threshold of 90)
- Several formatting issues: 50-74 (FAILS)
- Plain text block with no structure whatsoever: 0-30 (FAILS)

Be strict. A document that looks OK but lacks explicit section headings should score no higher than 70.`,
    threshold: 90,
    weight: 3,
    enabled: true,
    createdBy: admin.id,
  });

  // R5 — Easy Pass Baseline (team, manager)
  const r5 = await insertRule({
    teamId: team.id,
    name: "Easy Pass Baseline",
    desc: "Bare minimum check — just confirms the document is not gibberish.",
    prompt: `Does the document contain coherent text that appears to be intentionally written by a human?
Even rough drafts, informal notes, or short messages should score 70+.
Only score below 20 if the document is completely random characters, repeated filler text, or machine-generated noise with no coherent meaning.`,
    threshold: 20,
    weight: 1,
    enabled: true,
    createdBy: manager.id,
  });

  // R6 — Disabled Rule (team, manager) — INTENTIONALLY DISABLED
  const r6 = await insertRule({
    teamId: team.id,
    name: "Disabled Rule (must not run)",
    desc: "This rule must never appear in validation results. It is disabled.",
    prompt: `If you see this rule executing, report a bug to the development team immediately.
Return pass=false score=0 reasons=["ERROR: This rule should be disabled and must not run."]`,
    threshold: 60,
    weight: 1,
    enabled: false,   // ← DISABLED — critical for test scenario
    createdBy: manager.id,
  });

  // R7 — Grammar & Spelling (global, main_admin, uses {{TEXT}} placeholder)
  const r7 = await insertRule({
    teamId: null,
    name: "Grammar & Spelling",
    desc: "Evaluates spelling and grammatical accuracy using the full document text.",
    prompt: `Evaluate the following document for grammar and spelling errors.
---
{{TEXT}}
---
Scoring rubric:
- 90-100: Near-perfect grammar and spelling throughout
- 70-89: A few minor errors that do not impede comprehension
- 40-69: Noticeable errors that occasionally impede clarity; 10+ spelling mistakes
- 0-39: Pervasive errors throughout that make the document difficult to read

Deduct approximately 8 points per notable grammar error cluster.
Deduct approximately 5 points per repeated spelling mistake.`,
    threshold: 65,
    weight: 1,
    enabled: true,
    createdBy: admin.id,
  });

  // R8 — Data Privacy Check (team, manager)
  const r8 = await insertRule({
    teamId: team.id,
    name: "Data Privacy Check",
    desc: "Flags if the document contains personally identifiable information (PII).",
    prompt: `Check whether the document contains personally identifiable information (PII) such as:
- National ID / CNIC numbers (e.g. 12345-6789012-3)
- Passport numbers
- Credit card or bank account numbers
- Personal phone numbers
- Personal email addresses
- Home addresses

If ANY PII is found:
- Score: 0-25
- pass: false
- Add a flag with severity="fail" and a message listing what type of PII was detected.

If NO PII is present:
- Score: 90-100
- pass: true
- No flags needed.`,
    threshold: 80,
    weight: 2,
    enabled: true,
    createdBy: manager.id,
  });

  // R9 — Task Instructions Test (team, manager)
  const r9 = await insertRule({
    teamId: team.id,
    name: "Task Instructions Test",
    desc: "Generic relevance check — used to verify rule selection on individual tasks works.",
    prompt: `Verify that the document is broadly relevant to a professional business or operational context.
A document about general work activities, reports, proposals, or analyses should score 70-100.
A completely off-topic document (e.g. a personal diary entry or song lyrics) should score 0-40.
A borderline document with mixed relevance should score 40-69.`,
    threshold: 60,
    weight: 1,
    enabled: true,
    createdBy: manager.id,
  });

  // ── 4. Insert tasks ─────────────────────────────────────────────────────────
  printSection("3/5  Inserting 6 tasks");

  async function insertTask({ title, desc, instructions, dueAt, allowLate, lateDeadline, requireLateReason, ruleIds }) {
    const { rows } = await client.query(
      `INSERT INTO public.tasks
         (team_id, manager_id, title, description, instructions,
          due_at, allow_late, late_submission_deadline, require_late_reason, rule_ids)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        team.id,
        manager.id,
        title,
        desc ?? null,
        instructions ?? null,
        dueAt,
        allowLate,
        lateDeadline ?? null,
        requireLateReason ?? false,
        ruleIds === undefined ? null : ruleIds,   // null = all rules; [] = no rules; [ids] = specific
      ]
    );
    const id = rows[0].id;
    const lateStr = allowLate ? `✅ late until ${lateDeadline?.split("T")[0]}` : "❌ no late";
    const rulesStr = ruleIds === null ? "all rules" : ruleIds.length === 0 ? "NO rules" : `rules: [${ruleIds.length}]`;
    console.log(`  ✅ "${title}"`);
    console.log(`      due=${dueAt.split("T")[0]}  ${lateStr}  ${rulesStr}  → ${id}`);
    return id;
  }

  // T1 — Happy path, all rules, future deadline
  const t1 = await insertTask({
    title: "Quarterly Report Submission",
    desc: "Submit your Q3 performance report covering all KPIs, challenges, and next-quarter targets.",
    instructions: "The report must include: an executive summary, KPI breakdown table, challenges section, and at least three actionable next-quarter targets. Minimum length: 400 words.",
    dueAt: daysFromNow(7),
    allowLate: true,
    lateDeadline: daysFromNow(10),
    requireLateReason: true,
    ruleIds: null,   // all enabled rules
  });

  // T2 — Strict no-late deadline
  const t2 = await insertTask({
    title: "Weekly Ops Update — No Late",
    desc: "This week's operational update. Strict deadline — no extensions.",
    instructions: "Summarise team activity, blockers, and next-week priorities in bullet form. Keep it concise.",
    dueAt: daysFromNow(2),
    allowLate: false,
    lateDeadline: null,
    requireLateReason: false,
    ruleIds: null,
  });

  // T3 — Deadline already passed, grace period still open, only R2+R3
  const t3 = await insertTask({
    title: "Draft Proposal (Late-Friendly)",
    desc: "The main deadline has passed but the grace period is still open. Submit your draft proposal.",
    instructions: "The proposal must state: problem statement, proposed solution, estimated timeline.",
    dueAt: hoursAgo(1),       // ← 1 hour in the past
    allowLate: true,
    lateDeadline: daysFromNow(2),
    requireLateReason: true,
    ruleIds: [r2, r3],        // only Professional Language + Required Sections
  });

  // T4 — Completely expired, no late — hard rejection
  const t4 = await insertTask({
    title: "Expired Hard Deadline",
    desc: "This task is fully past its deadline. Any submission attempt must be rejected.",
    instructions: "Placeholder — any submission should be blocked at the server.",
    dueAt: daysFromNow(-3),   // ← 3 days in the past
    allowLate: false,
    lateDeadline: null,
    requireLateReason: false,
    ruleIds: null,
  });

  // T5 — Single strict rule (R4 only), single assignee
  const t5 = await insertTask({
    title: "Formatting Audit Submission",
    desc: "Submit any document to test whether the Strict Formatting Standard alone rejects unformatted files.",
    instructions: "Document must use clearly numbered sections, consistent headings, and no unbroken text walls.",
    dueAt: daysFromNow(5),
    allowLate: true,
    lateDeadline: daysFromNow(8),
    requireLateReason: true,
    ruleIds: [r4],            // only Strict Formatting Standard (threshold 90)
  });

  // T6 — No rules at all → "no rules configured" path
  const t6 = await insertTask({
    title: "Free-Form Note (No Rules)",
    desc: "Submit a free-form note. No AI validation is attached to this task.",
    instructions: null,
    dueAt: daysFromNow(3),
    allowLate: true,
    lateDeadline: daysFromNow(5),
    requireLateReason: false,
    ruleIds: [],              // empty array = explicitly skip all standing rules
  });

  // ── 5. Create task assignments ──────────────────────────────────────────────
  printSection("4/5  Creating task assignments");

  const allMemberIds = memberRows.map(m => m.id);

  async function assignAll(taskId, taskTitle, memberIds) {
    const rows = memberIds.map(id => `('${taskId}', '${id}', 'assigned')`).join(", ");
    await client.query(
      `INSERT INTO public.task_assignments (task_id, assignee_id, status)
       VALUES ${rows}
       ON CONFLICT DO NOTHING`
    );
    console.log(`  ✅ "${taskTitle}" → assigned to ${memberIds.length} member(s)`);
  }

  async function assignOne(taskId, taskTitle, memberId) {
    await client.query(
      `INSERT INTO public.task_assignments (task_id, assignee_id, status)
       VALUES ($1, $2, 'assigned')
       ON CONFLICT DO NOTHING`,
      [taskId, memberId]
    );
    const m = memberRows.find(r => r.id === memberId);
    console.log(`  ✅ "${taskTitle}" → assigned to ${m?.email ?? memberId} only`);
  }

  await assignAll(t1, "Quarterly Report Submission",    allMemberIds);
  await assignAll(t2, "Weekly Ops Update — No Late",    allMemberIds);
  await assignAll(t3, "Draft Proposal (Late-Friendly)", allMemberIds);
  await assignAll(t4, "Expired Hard Deadline",          allMemberIds);
  await assignOne(t5, "Formatting Audit Submission",    firstMember.id);  // T5: 1 member only
  await assignAll(t6, "Free-Form Note (No Rules)",      allMemberIds);

  // ── Commit ──────────────────────────────────────────────────────────────────
  await client.query("COMMIT");

  printSection("5/5  Done ✅");
  console.log(`
  Rules created  : 9  (R1–R9)
  Tasks created  : 6  (T1–T6)
  Assignments    : see above

  ┌──────────────────────────────────────────────────────┐
  │  IMPORTANT NOTES                                     │
  ├──────────────────────────────────────────────────────┤
  │  • T3 deadline is 1 hour in the past — submit now   │
  │    to test the late submission + grace period flow   │
  │  • T4 deadline is 3 days in the past — all submit   │
  │    attempts must be rejected by the server           │
  │  • T5 is assigned to ${firstMember.email.padEnd(28)} │
  │    only — use a different member to test S17         │
  │  • R6 is DISABLED — verify it never appears in      │
  │    any validation_runs results                       │
  └──────────────────────────────────────────────────────┘

  Open docs/TESTING_GUIDE.md to start Phase 3 (Submissions).
`);

} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("\n❌  Seed FAILED (rolled back):", err.message);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
