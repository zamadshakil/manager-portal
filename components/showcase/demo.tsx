"use client";
import { useState } from "react";
import Link from "next/link";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check, FileText, RotateCcw } from "lucide-react";
type Role = "manager" | "member";
type Task = {
  id: number;
  title: string;
  owner: string;
  file: string;
  status: string;
  brief: string;
  rules: string[];
  flag: string;
  feedback: string;
};
const sampleTasks: Task[] = [
  {
    id: 1,
    title: "Monthly client report",
    owner: "Aisha Khan",
    file: "september-report.pdf",
    status: "Needs review",
    brief:
      "Summarize the reporting period, campaign outcomes and next steps. Cite a source for every numerical claim.",
    rules: ["Reporting period included", "Required sections present"],
    flag: "The conversion-rate claim has no source reference.",
    feedback: "",
  },
  {
    id: 2,
    title: "Product content batch",
    owner: "Omar Ali",
    file: "catalog-batch-08.xlsx",
    status: "Ready for review",
    brief:
      "Submit the product title, description, category and approved source reference for each item.",
    rules: ["Required columns present", "All rows include source references"],
    flag: "Manager should confirm the descriptions fit the brand voice.",
    feedback: "",
  },
  {
    id: 3,
    title: "Training session outline",
    owner: "Sara Noor",
    file: "session-outline.docx",
    status: "Returned",
    brief:
      "Include learning objectives, a practical exercise, timing and an assessment checklist.",
    rules: ["Objectives included", "Practical exercise included"],
    flag: "Assessment checklist is missing.",
    feedback: "Please add the checklist and resubmit.",
  },
];
export function Demo({ initialRole = "manager" }: { initialRole?: Role }) {
  const [role, setRole] = useState<Role>(initialRole),
    [tasks, setTasks] = useState(sampleTasks),
    [selected, setSelected] = useState(1),
    [feedback, setFeedback] = useState(""),
    [notice, setNotice] = useState("");
  const task = tasks.find((t) => t.id === selected)!;
  function change(status: string) {
    setTasks((ts) =>
      ts.map((t) =>
        t.id === selected
          ? { ...t, status, feedback: feedback.trim() || t.feedback }
          : t,
      ),
    );
    setNotice(
      `Sample “${task.title}” marked ${status.toLowerCase()}. Nothing was sent or saved to a real workspace.`,
    );
    setFeedback("");
  }
  function reset() {
    setTasks(sampleTasks);
    setSelected(1);
    setFeedback("");
    setNotice("Sample workspace reset.");
  }
  return (
    <>
      <div className="sc-demo-header">
        <div>
          <p className="sc-eyebrow">INTERACTIVE SAMPLE · NO CLIENT DATA</p>
          <h1 style={{ fontSize: 38, marginBottom: 12 }}>Delivery workspace</h1>
          <p>
            Try a guest role. Changes stay in this page and reset on reload.
          </p>
        </div>
        <button className="sc-button secondary" onClick={reset}>
          <RotateCcw size={16} />
          Reset sample
        </button>
      </div>
      <Tabs
        value={role}
        onValueChange={(v) => {
          setRole(v as Role);
          setNotice("");
          setFeedback("");
        }}
      >
        <TabsList className="h-auto p-1 bg-[#e9f1ed]">
          <TabsTrigger className="px-5 py-3" value="manager">
            Guest manager
          </TabsTrigger>
          <TabsTrigger className="px-5 py-3" value="member">
            Guest member
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <p className="sc-fine">
        This is a guided simulation of the submission flow, not a signed-in live
        portal. AI findings below are prewritten examples; no AI request is
        made.
      </p>
      <div
        className="sc-preview-stats"
        style={{ margin: "25px 0", maxWidth: 650 }}
      >
        <div>
          <strong>{tasks.length}</strong>
          <span>Sample submissions</span>
        </div>
        <div>
          <strong>{tasks.filter((t) => t.status === "Approved").length}</strong>
          <span>Approved in this session</span>
        </div>
        <div>
          <strong>{tasks.filter((t) => t.status === "Returned").length}</strong>
          <span>Returned for revision</span>
        </div>
      </div>
      <div className="sc-demo-grid">
        <section aria-label="Sample submissions">
          {tasks.map((t) => (
            <button
              className={`sc-task ${selected === t.id ? "selected" : ""}`}
              key={t.id}
              onClick={() => {
                setSelected(t.id);
                setFeedback("");
                setNotice("");
              }}
              aria-pressed={selected === t.id}
            >
              <strong>
                <FileText
                  size={17}
                  style={{ display: "inline", marginRight: 8 }}
                />
                {t.title}
              </strong>
              <p>
                {t.owner} · {t.file}
              </p>
              <span className="sc-tag">{t.status}</span>
            </button>
          ))}
        </section>
        <section className="sc-panel">
          <p className="sc-eyebrow">
            {role === "manager"
              ? "REVIEW & DECIDE"
              : "READ FEEDBACK & RESUBMIT"}
          </p>
          <h2 style={{ fontSize: 25 }}>{task.title}</h2>
          <h3 style={{ fontSize: 16 }}>Task brief</h3>
          <p style={{ fontSize: 14 }}>{task.brief}</p>
          <h3 style={{ fontSize: 16 }}>Illustrative AI checks</h3>
          {task.rules.map((r) => (
            <div className="sc-rule" style={{ margin: 0 }} key={r}>
              <Check size={16} />
              <span>{r}</span>
            </div>
          ))}
          <p className="sc-status">For human attention: {task.flag}</p>
          {task.feedback && (
            <p style={{ fontSize: 14 }}>
              <strong>Manager feedback:</strong> {task.feedback}
            </p>
          )}
          {role === "manager" ? (
            <>
              <label className="sc-field" style={{ marginTop: 20 }}>
                Revision note
                <input
                  maxLength={500}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="Explain what needs to change"
                />
              </label>
              <div className="sc-demo-controls">
                <button
                  className="sc-button"
                  onClick={() => change("Approved")}
                >
                  Approve sample
                </button>
                <button
                  className="sc-button secondary"
                  disabled={!feedback.trim()}
                  onClick={() => change("Returned")}
                >
                  Return with note
                </button>
              </div>
            </>
          ) : (
            <>
              <p style={{ fontSize: 14, marginTop: 20 }}>
                Imagine you’ve updated the sample file using the feedback. No
                file upload is needed for this walkthrough.
              </p>
              <button
                className="sc-button"
                onClick={() => change("Ready for review")}
              >
                Simulate resubmission →
              </button>
            </>
          )}
        </section>
      </div>
      {notice && (
        <p className="sc-success" role="status">
          {notice}
        </p>
      )}
      <div className="sc-cta">
        <div>
          <h2>What would your team review here?</h2>
          <p>Let’s map a real workflow before planning a deployment.</p>
        </div>
        <Link
          className="sc-button"
          href="/showcase/audit?utm_source=demo&utm_medium=product&utm_campaign=workflow_audit"
        >
          Request a workflow audit →
        </Link>
      </div>
    </>
  );
}
