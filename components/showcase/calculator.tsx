"use client";
import { useState } from "react";
import Link from "next/link";
import { reviewEstimate } from "@/lib/funnel";

export function Calculator() {
  const [volume, setVolume] = useState(80),
    [minutes, setMinutes] = useState(12),
    [rework, setRework] = useState(25),
    [improvement, setImprovement] = useState(20);
  const result = reviewEstimate(volume, minutes, rework, improvement);
  const fields = [
    {
      label: "Submissions per week",
      value: volume,
      set: setVolume,
      max: 100000,
    },
    {
      label: "Minutes per first review",
      value: minutes,
      set: setMinutes,
      max: 480,
    },
    {
      label: "Submissions needing one repeat review (%)",
      value: rework,
      set: setRework,
      max: 100,
    },
    {
      label: "Hypothetical time reduction (%)",
      value: improvement,
      set: setImprovement,
      max: 100,
    },
  ];
  function download() {
    const rows = [
      "Hierarchia review-workload estimate",
      `Submissions/week,${volume}`,
      `Minutes/review,${minutes}`,
      `Repeat-review percent,${rework}`,
      `Review hours/week,${result.totalHours.toFixed(1)}`,
      `Assumed reduction percent,${improvement}`,
      `Potential hours/week (hypothesis),${result.potentialHours.toFixed(1)}`,
      "Assumption: one repeat review takes the same time as a first review.",
      "Planning estimate only. Not measured product performance or guaranteed savings.",
    ];
    const url = URL.createObjectURL(
      new Blob([rows.join("\r\n")], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "hierarchia-review-estimate.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="sc-form-layout">
      <div className="sc-panel sc-form">
        {fields.map((f) => (
          <label className="sc-field" key={f.label}>
            {f.label}
            <input
              type="number"
              min={0}
              max={f.max}
              value={f.value}
              onChange={(e) =>
                f.set(Math.max(0, Math.min(f.max, Number(e.target.value) || 0)))
              }
            />
          </label>
        ))}
        <p className="sc-fine">
          Assumes one repeat review per returned submission, taking the same
          time as the first review. Your inputs stay in this page.
        </p>
      </div>
      <div className="sc-panel" aria-live="polite">
        <p className="sc-eyebrow">YOUR WEEKLY REVIEW WORKLOAD</p>
        <div className="sc-result">
          {result.totalHours.toFixed(1)}{" "}
          <span style={{ fontSize: 22 }}>hours</span>
        </div>
        <p>
          {result.baseHours.toFixed(1)} hours on first reviews +{" "}
          {result.reworkHours.toFixed(1)} hours on repeat reviews.
        </p>
        <hr style={{ borderColor: "var(--sc-line)", margin: "24px 0" }} />
        <h2 style={{ fontSize: 25 }}>What if you reclaimed {improvement}%?</h2>
        <p>
          <strong>{result.potentialHours.toFixed(1)} hours per week</strong>{" "}
          could be redirected to other work.
        </p>
        <p className="sc-fine">
          A scenario, not a savings promise. We would test this assumption
          against your actual baseline in a pilot.
        </p>
        <div className="sc-actions">
          <button className="sc-button secondary" onClick={download}>
            Download my estimate
          </button>
          <Link
            className="sc-button"
            href="/showcase/audit?utm_source=calculator&utm_medium=website&utm_campaign=workflow_audit"
          >
            Discuss this workflow →
          </Link>
        </div>
      </div>
    </div>
  );
}
