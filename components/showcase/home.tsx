import Link from "next/link";
import {
  ArrowRight,
  Check,
  FileCheck2,
  ListChecks,
  ShieldCheck,
  GitBranch,
} from "lucide-react";
import { ShowcaseShell } from "./shell";

export const useCases = [
  {
    slug: "agencies",
    label: "Agencies & BPOs",
    title: "Less chasing. More client-ready work.",
    text: "Keep briefs, deliverables, revision reasons and team ownership together.",
    example: "Client report → brand and brief checks → manager review",
    buyer: "Founders, COOs and delivery leads",
    fit: "15–150 people with recurring, document-heavy delivery",
    rules: [
      "Client name and reporting period included",
      "All sections from the brief completed",
      "Claims supported by source material",
    ],
  },
  {
    slug: "ecommerce",
    label: "Ecommerce operations",
    title: "A consistent check before every handoff.",
    text: "Give catalog and content teams a shared checklist for every submission.",
    example: "Product sheet → content standards → catalog lead",
    buyer: "Heads of ecommerce and content operations",
    fit: "Teams managing repeatable catalog and content batches",
    rules: [
      "Required product fields present",
      "Descriptions follow your content checklist",
      "Missing source details flagged for a human",
    ],
  },
  {
    slug: "training",
    label: "Training operations",
    title: "Bring structure to recurring reviews.",
    text: "Make submission requirements and reviewer feedback visible to the whole team.",
    example: "Course material → delivery checklist → reviewer decision",
    buyer: "Training directors and operations managers",
    fit: "Teams coordinating instructors, materials and internal reviews",
    rules: [
      "Learning objectives and required sections present",
      "Reviewer uses the agreed rubric",
      "Final decisions remain with your team",
    ],
  },
];

export function ShowcaseHome() {
  return (
    <ShowcaseShell>
      <main>
        <section className="sc-hero sc-wrap">
          <div className="sc-hero-copy">
            <p className="sc-eyebrow">
              <span /> YOUR PROCESS. BUILT INTO EVERY REVIEW.
            </p>
            <h1>
              Great work shouldn’t get stuck in <em>review.</em>
            </h1>
            <p className="sc-lead">
              Turn scattered submissions into a clear workflow. Assign the work,
              check it against your rules with AI, and give managers the context
              to make the final call.
            </p>
            <div className="sc-actions">
              <Link className="sc-button" href="/showcase/audit">
                Request a free workflow audit <ArrowRight size={18} />
              </Link>
              <Link className="sc-text-link" href="/showcase/demo">
                Explore the sample workspace ↗
              </Link>
            </div>
            <p className="sc-fine">
              Custom deployment · Your workflow · A focused pilot before rollout
            </p>
          </div>
          <div
            className="sc-preview"
            aria-label="Illustrative submission review"
          >
            <div className="sc-preview-top">
              <span className="sc-dot" /> DELIVERY WORKSPACE{" "}
              <span className="sc-tag">SAMPLE</span>
            </div>
            <div className="sc-preview-heading">
              <FileCheck2 size={28} />
              <div>
                <h2>Monthly client report</h2>
                <p>Content operations / September</p>
              </div>
            </div>
            <div className="sc-preview-stats">
              <div>
                <strong>12</strong>
                <span>Submissions</span>
              </div>
              <div>
                <strong>3</strong>
                <span>Need review</span>
              </div>
              <div>
                <strong>9</strong>
                <span>Ready for a decision</span>
              </div>
            </div>
            <div className="sc-rule">
              <Check size={18} />
              <span>Reporting period included</span>
              <span>Pass</span>
            </div>
            <div className="sc-rule">
              <Check size={18} />
              <span>All required sections present</span>
              <span>Pass</span>
            </div>
            <div className="sc-rule warning">
              <span>!</span>
              <span>Source missing for one claim</span>
              <span>Review</span>
            </div>
            <div className="sc-note">
              <span className="sc-avatar">AK</span>
              <div>
                <strong>Manager review</strong>
                <p>“Add the source, then send this back for approval.”</p>
              </div>
            </div>
            <Link href="/showcase/demo" className="sc-preview-link">
              Open interactive sample <ArrowRight size={16} />
            </Link>
          </div>
        </section>
        <div className="sc-strip">
          <span>BRIEF</span>
          <ArrowRight />
          <span>SUBMISSION</span>
          <ArrowRight />
          <span>AI CHECK</span>
          <ArrowRight />
          <span>HUMAN DECISION</span>
        </div>
        <section className="sc-section sc-wrap" id="workflows">
          <div className="sc-section-head">
            <p className="sc-eyebrow">BUILT FOR REPEATABLE WORK</p>
            <h2>One process. Fewer loose ends.</h2>
            <p>
              For teams where managers spend too much time finding, checking and
              returning work.
            </p>
          </div>
          <div className="sc-grid3">
            {useCases.map((u, i) => (
              <Link
                className="sc-usecase"
                href={`/showcase/for/${u.slug}`}
                key={u.slug}
              >
                <span className="sc-number">0{i + 1}</span>
                <h3>{u.label}</h3>
                <p>{u.text}</p>
                <span className="sc-text-link">
                  See the workflow <ArrowRight size={16} />
                </span>
              </Link>
            ))}
          </div>
        </section>
        <section className="sc-dark">
          <div className="sc-wrap sc-split">
            <div>
              <p className="sc-eyebrow">NOT ANOTHER GENERIC TASK BOARD</p>
              <h2>
                A brief tells people what to do.
                <br />
                <em>A review process tells them what good looks like.</em>
              </h2>
              <Link href="/showcase/calculator" className="sc-button light">
                Calculate your review workload <ArrowRight size={18} />
              </Link>
            </div>
            <div className="sc-features">
              {[
                [
                  ListChecks,
                  "Make the standard explicit",
                  "Combine standing rules with the task brief, so every submission starts from the same expectations.",
                ],
                [
                  GitBranch,
                  "Keep the handoff visible",
                  "Track ownership, deadlines, revisions and late reasons in a role-aware workspace.",
                ],
                [
                  ShieldCheck,
                  "Keep people in control",
                  "AI flags what needs attention. Your managers remain responsible for review and approval.",
                ],
              ].map(([Icon, title, text]) => (
                <div className="sc-feature" key={String(title)}>
                  {typeof Icon !== "string" && <Icon size={24} />}
                  <div>
                    <h3>{String(title)}</h3>
                    <p>{String(text)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="sc-section sc-wrap">
          <div className="sc-section-head">
            <p className="sc-eyebrow">START SMALL. PROVE THE FIT.</p>
            <h2>Your workflow, before your rollout.</h2>
          </div>
          <div className="sc-grid3">
            {[
              [
                "01",
                "Map one workflow",
                "A free 20-minute conversation about volume, review time, rework and the people involved.",
              ],
              [
                "02",
                "Run a focused pilot",
                "Agree a paid 30-day pilot: one team, two workflows and clear acceptance criteria.",
              ],
              [
                "03",
                "Deploy for your team",
                "Scope your access model, integrations, hosting and support before a custom deployment.",
              ],
            ].map(([n, t, d]) => (
              <div className="sc-step" key={n}>
                <span className="sc-number">{n}</span>
                <h3>{t}</h3>
                <p>{d}</p>
              </div>
            ))}
          </div>
          <div className="sc-cta">
            <div>
              <h2>Where does review slow your team down?</h2>
              <p>Bring one workflow. We’ll work through the fit together.</p>
            </div>
            <Link href="/showcase/audit" className="sc-button">
              Request your workflow audit <ArrowRight size={18} />
            </Link>
          </div>
        </section>
      </main>
    </ShowcaseShell>
  );
}
