import { ShowcaseShell } from "@/components/showcase/shell";
import { LeadForm } from "@/components/showcase/lead-form";
export const metadata = { title: "Request a workflow audit | Hierarchia" };
export default function Page() {
  return (
    <ShowcaseShell>
      <main className="sc-wrap sc-page sc-form-layout">
        <div>
          <p className="sc-eyebrow">A FREE 20 MINUTE CONVERSATION</p>
          <h1>Let’s map one review workflow.</h1>
          <p className="sc-lead">
            Tell us what your team submits, what managers check and where work
            comes back for another pass.
          </p>
          <ul className="sc-list">
            <li>Map the current handoff and its owner</li>
            <li>Identify repeated checks and common revision reasons</li>
            <li>Agree what a useful pilot would test</li>
          </ul>
          <p>
            No confidential files needed. An anonymized example and rough weekly
            volume are enough.
          </p>
        </div>
        <div className="sc-panel">
          <LeadForm ready />
        </div>
      </main>
    </ShowcaseShell>
  );
}
