"use client";

import { useState } from "react";
import Link from "next/link";
import {
  FileText, Check, AlertTriangle, ArrowRight, ExternalLink,
  ShieldCheck, RotateCcw, Sparkles, Building2, UserCheck, Eye
} from "lucide-react";

type SampleDoc = {
  id: number;
  title: string;
  category: string;
  specialist: string;
  file: string;
  score: number;
  status: "Passed" | "Needs Review" | "Failed";
  rules: { name: string; pass: boolean; note: string }[];
  flag: string;
  defaultFeedback: string;
};

const sampleDocs: SampleDoc[] = [
  {
    id: 1,
    title: "North Facility HVAC & Boiler Audit",
    category: "Commercial Facilities",
    specialist: "Alex Rivera",
    file: "north-hvac-audit-q3.pdf",
    score: 94.5,
    status: "Passed",
    rules: [
      { name: "Operating vibration within threshold (< 4.2 mm/s)", pass: true, note: "Bearing vibration measured at 4.1 mm/s" },
      { name: "Gauge calibration tags valid & photos attached", pass: true, note: "3 high-resolution site photos verified" },
      { name: "Refrigerant pressure within operating range (110-125 PSI)", pass: true, note: "Measured at 118 PSI" },
      { name: "Secondary supervisor counter-signature", pass: false, note: "Lead technician signed; supervisor sign-off pending" },
    ],
    flag: "Secondary facility supervisor counter-signature is pending sign-off.",
    defaultFeedback: "",
  },
  {
    id: 2,
    title: "Hazardous Materials Compliance Log",
    category: "Environmental & Safety",
    specialist: "Elena Rostova",
    file: "hazmat-handling-protocol.pdf",
    score: 64.0,
    status: "Needs Review",
    rules: [
      { name: "Secondary containment checklist completed", pass: true, note: "All storage drums verified on spill pallets" },
      { name: "Emergency eyewash station inspection date valid", pass: true, note: "Tested within last 7 days" },
      { name: "Disposal manifest signed by licensed carrier", pass: false, note: "Carrier signature box left empty" },
    ],
    flag: "Disposal manifest is missing licensed transport carrier signature.",
    defaultFeedback: "Please upload the manifest page with the licensed carrier's stamp and signature.",
  },
  {
    id: 3,
    title: "Emergency Generator Load Test",
    category: "Electrical & Critical Systems",
    specialist: "Marcus Vance",
    file: "generator-load-test-log.xlsx",
    score: 38.0,
    status: "Failed",
    rules: [
      { name: "Transfer switch response within 10 seconds", pass: true, note: "Switched in 8.4 seconds" },
      { name: "Vibration telemetry below safety threshold (< 4.2 mm/s)", pass: false, note: "Telemetry reported 4.8 mm/s on motor mounts" },
      { name: "Exhaust backpressure within allowable limits", pass: true, note: "Within normal operating curve" },
      { name: "Full 100% load test maintained for 60 minutes", pass: false, note: "Test aborted at minute 42 due to vibration" },
    ],
    flag: "Vibration threshold exceeded (4.8 mm/s). Immediate motor mount inspection required.",
    defaultFeedback: "Abort test verified. Re-torque motor mounts and re-run full 60-minute cycle before sign-off.",
  },
];

export function Demo({ initialRole }: { initialRole?: "manager" | "member" | string } = {}) {
  const [docs, setDocs] = useState<SampleDoc[]>(sampleDocs);
  const [selectedId, setSelectedId] = useState<number>(1);
  const [feedback, setFeedback] = useState<string>("");
  const [notice, setNotice] = useState<string>("");

  const activeDoc = docs.find((d) => d.id === selectedId) || docs[0];

  function handleDecision(newStatus: "Passed" | "Needs Review" | "Failed") {
    setDocs((current) =>
      current.map((d) =>
        d.id === activeDoc.id
          ? { ...d, status: newStatus, defaultFeedback: feedback || d.defaultFeedback }
          : d
      )
    );
    setNotice(
      `“${activeDoc.title}” marked as ${newStatus}. Action recorded in sample audit trail.`
    );
    setFeedback("");
  }

  function handleReset() {
    setDocs(sampleDocs);
    setSelectedId(1);
    setFeedback("");
    setNotice("Sample inspection workspace reset.");
  }

  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-[var(--sc-line)]">
        <div>
          <p className="sc-eyebrow">INTERACTIVE INSPECTOR &middot; SAMPLE WORKSPACE</p>
          <h1 style={{ fontSize: 34, margin: "6px 0 10px 0" }}>Operations Review Workspace</h1>
          <p style={{ color: "var(--sc-muted)", fontSize: 16 }}>
            Click any submitted report below to see real-time AI checklist evaluation and manager review actions.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button className="sc-button secondary small" onClick={handleReset}>
            <RotateCcw size={15} />
            Reset Sample
          </button>
          <a
            href="https://hirarchia.zamdevai.com/auth/login"
            target="_blank"
            rel="noopener noreferrer"
            className="sc-button small"
          >
            Launch Live Portal ↗
          </a>
        </div>
      </div>

      {/* 3-Document Selector Bar */}
      <div>
        <div className="text-xs font-bold uppercase tracking-wider text-[var(--sc-muted)] mb-3">
          Select a sample submission to inspect:
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {docs.map((d) => {
            const isSelected = d.id === activeDoc.id;
            return (
              <button
                key={d.id}
                onClick={() => {
                  setSelectedId(d.id);
                  setFeedback("");
                  setNotice("");
                }}
                className={`p-4 rounded-xl text-left transition-all border ${
                  isSelected
                    ? "bg-white border-[#16634d] shadow-md ring-2 ring-[#16634d]/20"
                    : "bg-white border-[var(--sc-line)] hover:border-[#16634d]/50"
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-bold text-[var(--sc-muted)] uppercase">
                    {d.category}
                  </span>
                  <span
                    className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                      d.status === "Passed"
                        ? "bg-emerald-100 text-emerald-800"
                        : d.status === "Needs Review"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-rose-100 text-rose-800"
                    }`}
                  >
                    {d.score}% &middot; {d.status}
                  </span>
                </div>
                <div className="font-bold text-sm text-[var(--sc-ink)] leading-snug line-clamp-1">
                  {d.title}
                </div>
                <div className="text-xs text-[var(--sc-muted)] mt-1">
                  {d.specialist} &middot; {d.file}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Inspection Mockup Grid */}
      <div className="sc-doc-mockup" style={{ marginTop: 0 }}>
        {/* Mockup Top Header */}
        <div className="sc-doc-header">
          <div className="sc-doc-title">
            <FileText size={20} className="text-[#16634d]" />
            <div>
              <h3>{activeDoc.title}</h3>
              <p>Submitted by {activeDoc.specialist} &middot; {activeDoc.file} (2.4 MB)</p>
            </div>
          </div>
          <div className="sc-doc-meta">
            <span className="sc-badge">
              <ShieldCheck size={14} /> AI Evaluated
            </span>
            <span
              className={`sc-badge ${
                activeDoc.status === "Passed"
                  ? "approved"
                  : activeDoc.status === "Needs Review"
                  ? ""
                  : ""
              }`}
              style={{
                background:
                  activeDoc.status === "Passed"
                    ? "#dcfce7"
                    : activeDoc.status === "Needs Review"
                    ? "#fef3c7"
                    : "#fee2e2",
                color:
                  activeDoc.status === "Passed"
                    ? "#166534"
                    : activeDoc.status === "Needs Review"
                    ? "#92400e"
                    : "#991b1b",
              }}
            >
              {activeDoc.score}% Score &middot; {activeDoc.status}
            </span>
          </div>
        </div>

        {/* Mockup Body */}
        <div className="sc-doc-body">
          <div className="text-xs font-bold uppercase tracking-wider text-[var(--sc-muted)] mb-3">
            Checklist Rule Evaluation:
          </div>
          <div className="space-y-2.5">
            {activeDoc.rules.map((rule, idx) => (
              <div
                key={idx}
                className={`sc-doc-rule ${rule.pass ? "pass" : "fail"}`}
              >
                <div className="sc-rule-indicator">
                  {rule.pass ? <Check size={14} /> : <AlertTriangle size={14} />}
                </div>
                <div className="sc-rule-info">
                  <strong>{rule.name}</strong>
                  <span>{rule.note}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Exception Banner */}
          {activeDoc.flag && (
            <div
              style={{
                marginTop: 20,
                padding: "14px 16px",
                borderRadius: 10,
                background: "#fef8ee",
                border: "1px solid #fbd38d",
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              <AlertTriangle size={18} color="#b7791f" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong style={{ fontSize: 13, color: "#744210", display: "block" }}>
                  For Reviewer Attention:
                </strong>
                <p style={{ fontSize: 13, color: "#975a16", margin: "2px 0 0 0" }}>
                  {activeDoc.flag}
                </p>
              </div>
            </div>
          )}

          {/* Previous or Saved Feedback */}
          {activeDoc.defaultFeedback && (
            <div
              style={{
                marginTop: 14,
                padding: "12px 16px",
                borderRadius: 10,
                background: "#f7faf9",
                border: "1px solid var(--sc-line)",
                fontSize: 13,
              }}
            >
              <strong>Manager Revision Request:</strong> {activeDoc.defaultFeedback}
            </div>
          )}
        </div>

        {/* Mockup Manager Action Footer */}
        <div className="sc-doc-footer">
          <div style={{ flex: 1, minWidth: 240 }}>
            <label className="text-xs font-semibold text-[var(--sc-ink)] block mb-1.5">
              Reviewer Note / Return Instructions:
            </label>
            <input
              type="text"
              className="w-full px-3 py-2 rounded-lg border border-[var(--sc-line)] text-xs text-[var(--sc-ink)] placeholder:text-[var(--sc-muted)] focus:outline-none focus:border-[#16634d]"
              placeholder="e.g. Please re-attach calibration photo page and resubmit..."
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
          </div>
          <div className="sc-doc-actions" style={{ marginTop: 20 }}>
            <button
              className="sc-button secondary small"
              onClick={() => handleDecision("Needs Review")}
            >
              Return for Revision
            </button>
            <button
              className="sc-button small"
              onClick={() => handleDecision("Passed")}
            >
              Approve Report ✓
            </button>
          </div>
        </div>
      </div>

      {notice && (
        <div
          role="status"
          style={{
            padding: "12px 18px",
            background: "#dcfce7",
            border: "1px solid #86efac",
            borderRadius: 10,
            fontSize: 13,
            color: "#14532d",
            fontWeight: 600,
          }}
        >
          {notice}
        </div>
      )}

      {/* Live Portal Launchpad (3 Roles) */}
      <div className="sc-live-banner">
        <div>
          <span className="sc-badge" style={{ background: "rgba(255,255,255,0.15)", color: "#fff", border: "none" }}>
            <Sparkles size={14} /> LIVE DEMO PLATFORM
          </span>
          <h2 style={{ fontSize: 26, margin: "10px 0 6px 0", color: "#fff" }}>
            Experience the real, fully deployed system
          </h2>
          <p style={{ color: "rgba(255,255,255,0.8)", fontSize: 14, margin: 0 }}>
            Test drive Hierarchia with pre-configured 1-click credentials for each role:
          </p>
        </div>

        <div className="sc-roles-grid" style={{ width: "100%", margin: "16px 0" }}>
          {/* Role 1 */}
          <div className="sc-role-card">
            <h4>👑 Super Admin</h4>
            <p>Rule engine, organization settings, department quotas, and system audit logs.</p>
            <code>admin@zamdevai.com</code>
            <a
              href="https://hirarchia.zamdevai.com/auth/login"
              target="_blank"
              rel="noopener noreferrer"
              className="sc-button small"
              style={{ width: "100%", justifyContent: "center" }}
            >
              Sign In as Admin <ExternalLink size={14} />
            </a>
          </div>

          {/* Role 2 */}
          <div className="sc-role-card">
            <h4>👔 Operations Manager</h4>
            <p>Exception review queue, AI scores, 1-click approvals, and team messaging.</p>
            <code>manager@zamdevai.com</code>
            <a
              href="https://hirarchia.zamdevai.com/auth/login"
              target="_blank"
              rel="noopener noreferrer"
              className="sc-button small"
              style={{ width: "100%", justifyContent: "center" }}
            >
              Sign In as Manager <ExternalLink size={14} />
            </a>
          </div>

          {/* Role 3 */}
          <div className="sc-role-card">
            <h4>👷 Field Specialist</h4>
            <p>Task checklist submissions, instant validation feedback, and revision loop.</p>
            <code>specialist@zamdevai.com</code>
            <a
              href="https://hirarchia.zamdevai.com/auth/login"
              target="_blank"
              rel="noopener noreferrer"
              className="sc-button small"
              style={{ width: "100%", justifyContent: "center" }}
            >
              Sign In as Specialist <ExternalLink size={14} />
            </a>
          </div>
        </div>

        <div style={{ textAlign: "center", width: "100%" }}>
          <a
            href="https://hirarchia.zamdevai.com/auth/login"
            target="_blank"
            rel="noopener noreferrer"
            className="sc-button light"
            style={{ display: "inline-flex", padding: "12px 28px", fontSize: 15 }}
          >
            Launch Live Portal at hirarchia.zamdevai.com →
          </a>
        </div>
      </div>

      {/* Workflow Audit CTA */}
      <div className="sc-cta">
        <div>
          <h2>Ready to map your team’s document review process?</h2>
          <p>Bring one repetitive report. We’ll configure the rules and demonstrate the fit.</p>
        </div>
        <Link
          className="sc-button"
          href="/showcase/audit?utm_source=demo&utm_medium=product&utm_campaign=workflow_audit"
        >
          Request a workflow audit →
        </Link>
      </div>
    </div>
  );
}
