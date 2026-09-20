import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  UploadCloud,
  Cpu,
  ShieldCheck,
  FileSpreadsheet,
  FileText,
  XCircle,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { ShowcaseShell } from "@/components/showcase/shell";
import { useCases } from "@/components/showcase/home";

type SegmentVisual = {
  docIcon: typeof FileText;
  docTitle: string;
  docSub: string;
  submitter: string;
  role: string;
  avatar: string;
  score: string;
  rules: { title: string; status: "pass" | "warning"; note: string }[];
  managerNote: string;
  pipeline: { step: string; title: string; desc: string; badge: string }[];
  pains: string[];
  gains: string[];
};

const segmentVisuals: Record<string, SegmentVisual> = {
  ecommerce: {
    docIcon: FileSpreadsheet,
    docTitle: "Catalog Intake Batch 08 — Autumn Line (240 SKUs)",
    docSub: "catalog-batch-08.xlsx · 240 items · Apparel & Accessories",
    submitter: "Omar Ali",
    role: "Content & Catalog Specialist",
    avatar: "OA",
    score: "92% AI Passed",
    rules: [
      {
        title: "Required product fields present (SKU, Title, Category, MSRP)",
        status: "pass",
        note: "240/240 rows complete",
      },
      {
        title: "Descriptions follow brand voice & word count criteria",
        status: "pass",
        note: "Target 80–120 words verified",
      },
      {
        title: "Manufacturer country of origin & certifications present",
        status: "warning",
        note: "Missing on 3 SKUs (rows 42, 118, 203)",
      },
    ],
    managerNote: "Review only the 3 flagged items instead of re-reading 240 rows.",
    pipeline: [
      {
        step: "01",
        title: "Team Submits Catalog Batch",
        desc: "Content team uploads bulk product sheets. Automated file validation logs every row.",
        badge: "catalog-batch-08.xlsx",
      },
      {
        step: "02",
        title: "Instant AI Inspection",
        desc: "Rules verify SKU attributes, word counts, and missing tags in 3 seconds.",
        badge: "92% Pass · 1 Flagged",
      },
      {
        step: "03",
        title: "1-Click Lead Sign-Off",
        desc: "Catalog manager inspects flagged exceptions and approves with full audit logging.",
        badge: "Approved & Synced",
      },
    ],
    pains: [
      "Catalog leads manually scrolling through hundreds of spreadsheet rows every week",
      "Missing attributes discovered only after syncing to store, causing customer returns",
      "Endless email threads asking specialists to fix forgotten image links or tags",
      "Zero central visibility into who submitted what batch and when it was verified",
    ],
    gains: [
      "AI pre-flight catches 95% of formatting errors before managers even open the file",
      "Review time drops from 45 minutes per catalog batch to under 2 minutes",
      "Instant feedback to uploaders with exact row numbers requiring correction",
      "Immutable audit trail of who created, checked, and approved each catalog batch",
    ],
  },
  agencies: {
    docIcon: FileText,
    docTitle: "Monthly Client Performance Report — Q3 Milestone",
    docSub: "apex-q3-performance-report.pdf · 28 pages · Client: Apex Retail UK",
    submitter: "Aisha Khan",
    role: "Account & Delivery Lead",
    avatar: "AK",
    score: "95% AI Passed",
    rules: [
      {
        title: "Client contract KPIs and reporting dates matched to brief",
        status: "pass",
        note: "All 5 contractual KPIs included",
      },
      {
        title: "Executive summary and forward quarterly milestones present",
        status: "pass",
        note: "Verified on pages 2–4",
      },
      {
        title: "Every numerical ROI / conversion claim backed by verified analytics link",
        status: "warning",
        note: "Slide 14 claim missing GA4 attribution link",
      },
    ],
    managerNote: "Deliverable verified. Account lead prompted to attach source citation.",
    pipeline: [
      {
        step: "01",
        title: "Deliverables Uploaded",
        desc: "Delivery teams submit decks and reports against clear client brief templates.",
        badge: "client-report.pdf",
      },
      {
        step: "02",
        title: "AI Quality Pre-Flight",
        desc: "AI verifies mandatory sections, metric calculations, and citations automatically.",
        badge: "95% Pass · 1 Citation Flag",
      },
      {
        step: "03",
        title: "Partner Signs Off",
        desc: "Managing partner reviews highlighted exceptions and signs off in 30 seconds.",
        badge: "Client Ready",
      },
    ],
    pains: [
      "Client deliverables submitted across Slack, Google Drive, and email attachments",
      "Account directors spending late nights proofreading reports before client presentations",
      "Embarrassing errors and unverified claims reaching client executive desks",
      "No single source of truth when clients question when a deliverable was submitted",
    ],
    gains: [
      "Centralized intake queue where every client report has clear ownership and deadlines",
      "AI verifies adherence to client brand rubrics and required sections automatically",
      "Partners sign off with confidence having verified proof for every claim",
      "Complete client-ready audit history with timestamped sign-offs",
    ],
  },
  training: {
    docIcon: FileText,
    docTitle: "Technical Safety Certification Course Pack (Module 04)",
    docSub: "safety-course-module-04.docx · 18 pages · Level 2 Health & Safety",
    submitter: "Sara Noor",
    role: "Lead Curriculum Coordinator",
    avatar: "SN",
    score: "94% AI Passed",
    rules: [
      {
        title: "Accreditation learning objectives and required syllabus topics verified",
        status: "pass",
        note: "Aligned with 2026 OSHA standards",
      },
      {
        title: "Practical exercise worksheets, timing, and assessment rubrics attached",
        status: "pass",
        note: "4 hands-on modules configured",
      },
      {
        title: "Instructor qualification credentials and supervisor sign-off sheet",
        status: "warning",
        note: "Supervisor signature blank on Annex C",
      },
    ],
    managerNote: "Course pack audited. Signature prompt dispatched to instructor.",
    pipeline: [
      {
        step: "01",
        title: "Curriculum Uploaded",
        desc: "Instructors submit course plans, exercises, and handouts before term starts.",
        badge: "course-module-04.docx",
      },
      {
        step: "02",
        title: "Compliance Pre-Check",
        desc: "AI inspects lesson plans against accreditation criteria and standards in seconds.",
        badge: "94% Pass · 1 Signature Missing",
      },
      {
        step: "03",
        title: "Director Certification",
        desc: "Training director confirms full compliance and approves materials for student rollout.",
        badge: "Certified for Release",
      },
    ],
    pains: [
      "Instructors using outdated versions of safety exercises and compliance rubrics",
      "Audit failures during regulatory inspections due to missing instructor credentials",
      "Hours wasted manually cross-referencing syllabi against accreditation requirements",
      "Fragmented feedback loops between instructors and curriculum directors",
    ],
    gains: [
      "Strict rubric enforcement: materials cannot be dispatched with missing compliance elements",
      "AI automatically flags missing safety checklists, time allocations, and sign-offs",
      "Curriculum directors gain instant visibility over all active courses and trainers",
      "Permanent, exportable audit logs ready for regulatory inspections anytime",
    ],
  },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ segment: string }>;
}) {
  const { segment } = await params;
  const u = useCases.find((x) => x.slug === segment);
  return { title: u ? `${u.label} Workflow | Hierarchia` : "Workflow not found" };
}

export default async function Page({
  params,
}: {
  params: Promise<{ segment: string }>;
}) {
  const { segment } = await params;
  const u = useCases.find((x) => x.slug === segment);
  if (!u) notFound();

  const visual = segmentVisuals[segment] || segmentVisuals.ecommerce;
  const DocIcon = visual.docIcon;

  return (
    <ShowcaseShell>
      <main className="sc-wrap sc-page">
        {/* Header Hero */}
        <div style={{ maxWidth: 840, marginBottom: 35 }}>
          <div className="sc-badge info" style={{ marginBottom: 16 }}>
            <Sparkles size={14} /> AI-POWERED DOCUMENT OPS FOR {u.label.toUpperCase()}
          </div>
          <h1 style={{ fontSize: 44, lineHeight: 1.15, marginBottom: 16 }}>
            {u.title}
          </h1>
          <p className="sc-lead" style={{ fontSize: 20, color: "#475955", lineHeight: 1.5 }}>
            {u.text} Stop chasing team members or wasting hours reading repetitive documents.
            Let AI pre-check submissions against your exact rules so managers can approve in seconds.
          </p>

          <div className="sc-actions" style={{ marginTop: 28, gap: 14 }}>
            <a
              className="sc-button"
              href="https://hirarchia.zamdevai.com/auth/login"
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
            >
              Try Live Platform Demo <ExternalLink size={16} />
            </a>
            <Link
              className="sc-button secondary"
              href={`/showcase/audit?segment=${u.slug}&utm_source=${u.slug}&utm_medium=website`}
            >
              Request a 20-Min Workflow Audit →
            </Link>
          </div>
        </div>

        {/* ── 3-Step Visual Workflow Pipeline ── */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div className="sc-dot" />
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.2, color: "#16634d" }}>
              HOW THE WORKFLOW RUNS
            </span>
          </div>
          <h2 style={{ fontSize: 28, marginBottom: 10 }}>From scattered files to verified approvals in 3 steps</h2>
          <p style={{ color: "#50635f", maxWidth: 640, margin: 0 }}>
            Every submission follows an automated pre-flight path before reaching your managers.
          </p>

          <div className="sc-pipeline-grid">
            {visual.pipeline.map((p, idx) => (
              <div className="sc-pipeline-card" key={p.step}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <span className="sc-pipeline-step">STEP {p.step}</span>
                  {idx === 0 && <UploadCloud size={20} color="#16634d" />}
                  {idx === 1 && <Cpu size={20} color="#16634d" />}
                  {idx === 2 && <ShieldCheck size={20} color="#16634d" />}
                </div>
                <h3>{p.title}</h3>
                <p>{p.desc}</p>
                <div className="sc-pipeline-preview">
                  <span>Status:</span>
                  <span className={`sc-badge ${idx === 2 ? "success" : "info"}`}>{p.badge}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Visual Document Inspection Mockup ── */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div className="sc-dot" />
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.2, color: "#16634d" }}>
              LIVE INSPECTION PREVIEW
            </span>
          </div>
          <h2 style={{ fontSize: 28, marginBottom: 10 }}>What managers actually see</h2>
          <p style={{ color: "#50635f", maxWidth: 640, margin: "0 0 20px" }}>
            No wading through 30 pages or hundreds of spreadsheet rows. Managers see instant rule status,
            highlighted exceptions, and one-click actions.
          </p>

          <div className="sc-doc-mockup">
            {/* Mockup Header */}
            <div className="sc-doc-header">
              <div className="sc-doc-info">
                <div style={{ background: "#ffffff", padding: 10, borderRadius: 8, border: "1px solid #d6e3df", display: "flex" }}>
                  <DocIcon size={24} color="#16634d" />
                </div>
                <div>
                  <h3>{visual.docTitle}</h3>
                  <p>{visual.docSub}</p>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className="sc-badge success">{visual.score}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#ffffff", padding: "4px 10px", borderRadius: 999, border: "1px solid #d6e3df" }}>
                  <span className="sc-avatar" style={{ width: 22, height: 22, fontSize: 10 }}>{visual.avatar}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#122724" }}>{visual.submitter}</span>
                </div>
              </div>
            </div>

            {/* Mockup Body with Rules */}
            <div className="sc-doc-body">
              <div style={{ fontSize: 12, fontWeight: 700, color: "#50635f", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 }}>
                Automated AI Pre-Flight Criteria
              </div>
              <div className="sc-doc-rules">
                {visual.rules.map((rule, i) => (
                  <div className="sc-doc-rule-row" key={i}>
                    <div className="sc-doc-rule-left">
                      {rule.status === "pass" ? (
                        <CheckCircle2 size={18} color="#137333" />
                      ) : (
                        <AlertTriangle size={18} color="#b06000" />
                      )}
                      <span>{rule.title}</span>
                    </div>
                    <div className="sc-doc-rule-detail">
                      <span className={`sc-badge ${rule.status === "pass" ? "success" : "warning"}`}>
                        {rule.status === "pass" ? "PASSED" : "NEEDS ATTENTION"}
                      </span>
                      <div style={{ fontSize: 11, color: "#61736f", marginTop: 2 }}>{rule.note}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Mockup Action Bar */}
              <div className="sc-doc-action-bar">
                <div className="sc-doc-action-status">
                  <strong>Manager Decision Note:</strong> {visual.managerNote}
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <a
                    href="https://hirarchia.zamdevai.com/auth/login"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="sc-button small"
                    style={{ background: "#16634d", color: "#fff" }}
                  >
                    ✓ 1-Click Approve Deliverable
                  </a>
                  <a
                    href="https://hirarchia.zamdevai.com/auth/login"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="sc-button small secondary"
                  >
                    ↩ Return with Feedback
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Before vs After Visual Comparison ── */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div className="sc-dot" />
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.2, color: "#16634d" }}>
              THE PRACTICAL DIFFERENCE
            </span>
          </div>
          <h2 style={{ fontSize: 28, marginBottom: 10 }}>Without Hierarchia vs With Hierarchia</h2>
          <p style={{ color: "#50635f", maxWidth: 640, margin: 0 }}>
            Here is how your operations look before and after switching to an automated review workflow.
          </p>

          <div className="sc-comp-grid">
            <div className="sc-comp-col bad">
              <h4>
                <XCircle size={20} /> Without Hierarchia (Manual Review Chaos)
              </h4>
              <ul className="sc-comp-list">
                {visual.pains.map((p, i) => (
                  <li key={i}>
                    <span style={{ color: "#9c2727", fontWeight: 700 }}>✕</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="sc-comp-col good">
              <h4>
                <CheckCircle2 size={20} /> With Hierarchia (Automated Clarity)
              </h4>
              <ul className="sc-comp-list">
                {visual.gains.map((g, i) => (
                  <li key={i}>
                    <span style={{ color: "#16634d", fontWeight: 700 }}>✓</span>
                    <span>{g}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* ── Full Width Call To Action Banner ── */}
        <div className="sc-live-banner">
          <div>
            <div className="sc-badge success" style={{ background: "rgba(255,255,255,0.15)", color: "#ffffff", border: "1px solid rgba(255,255,255,0.3)", marginBottom: 12 }}>
              1-CLICK TEST DRIVE READY
            </div>
            <h3>Ready to see how fast your reviews become?</h3>
            <p>
              Launch the live interactive platform directly. Log in with 1 click as Super Admin,
              Operations Manager, or Field Specialist with sample documents and real AI checks.
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, flexShrink: 0 }}>
            <a
              href="https://hirarchia.zamdevai.com/auth/login"
              target="_blank"
              rel="noopener noreferrer"
              className="sc-btn-live"
            >
              Launch Live Demo Portal <ExternalLink size={16} />
            </a>
            <Link
              href={`/showcase/audit?segment=${u.slug}&utm_source=${u.slug}&utm_medium=website`}
              style={{ color: "#bde0d4", fontSize: 13, textAlign: "center", textDecoration: "underline" }}
            >
              Or request a free 20-min workflow audit
            </Link>
          </div>
        </div>
      </main>
    </ShowcaseShell>
  );
}
