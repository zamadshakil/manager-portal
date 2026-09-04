import Link from "next/link";
import { ShowcaseShell } from "@/components/showcase/shell";
export const metadata = { title: "Workflow audit worksheet | Hierarchia" };
export default function Page() {
  return (
    <ShowcaseShell>
      <main className="sc-wrap sc-page sc-prose">
        <p className="sc-eyebrow">FREE WORKFLOW WORKSHEET</p>
        <h1>Map one submission from brief to decision.</h1>
        <p className="sc-lead">
          Copy these questions into your next team conversation. Use anonymized
          examples.
        </p>
        {[
          [
            "1. Define the unit of work",
            "What document or deliverable gets submitted? Who creates it? Who reviews it?",
          ],
          [
            "2. Count the volume",
            "How many arrive each week? How many minutes does one first review take?",
          ],
          [
            "3. Make the checklist explicit",
            "What are your three most common checks? Which are objective, and which require judgment?",
          ],
          [
            "4. Find the return loop",
            "What percentage needs another review? What are the top three reasons?",
          ],
          [
            "5. Agree ownership",
            "Who can accept, return and escalate work? How are overdue submissions handled?",
          ],
          [
            "6. Define a pilot decision",
            "What baseline will you measure? What improvement would justify a rollout? What error rate would stop it?",
          ],
        ].map(([t, d]) => (
          <section key={t}>
            <h2>{t}</h2>
            <p>{d}</p>
          </section>
        ))}
        <div className="sc-actions">
          <a
            className="sc-button secondary"
            href="/showcase/resources/worksheet.txt"
            download
          >
            Download worksheet
          </a>
          <Link
            className="sc-button"
            href="/showcase/audit?utm_source=worksheet&utm_medium=resource"
          >
            Talk through my workflow →
          </Link>
        </div>
      </main>
    </ShowcaseShell>
  );
}
