import Link from "next/link";
import { notFound } from "next/navigation";
import { ShowcaseShell } from "@/components/showcase/shell";
import { useCases } from "@/components/showcase/home";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ segment: string }>;
}) {
  const { segment } = await params;
  const u = useCases.find((x) => x.slug === segment);
  return { title: u ? `${u.label} | Hierarchia` : "Workflow not found" };
}
export default async function Page({
  params,
}: {
  params: Promise<{ segment: string }>;
}) {
  const { segment } = await params;
  const u = useCases.find((x) => x.slug === segment);
  if (!u) notFound();
  return (
    <ShowcaseShell>
      <main className="sc-wrap sc-page">
        <p className="sc-eyebrow">HIERARCHIA FOR {u.label.toUpperCase()}</p>
        <h1>{u.title}</h1>
        <p className="sc-lead">{u.text}</p>
        <div className="sc-actions">
          <Link
            className="sc-button"
            href={`/showcase/audit?segment=${u.slug}&utm_source=${u.slug}&utm_medium=website`}
          >
            Map our workflow →
          </Link>
          <Link className="sc-text-link" href="/showcase/demo">
            Explore the sample workspace
          </Link>
        </div>
        <section className="sc-section sc-form-layout">
          <div>
            <h2>Start with one repeatable handoff.</h2>
            <p>{u.example}</p>
            <ul className="sc-list">
              {u.rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="sc-fine">
              Illustrative checks. Your rubric and AI validation quality must be
              tested with representative, anonymized submissions.
            </p>
          </div>
          <div className="sc-panel">
            <p className="sc-eyebrow">A USEFUL FIT WHEN</p>
            <h3>{u.fit}</h3>
            <p>Built for conversations with {u.buyer.toLowerCase()}.</p>
            <h3>The pilot decision</h3>
            <p>
              Compare review time, repeat submissions and reviewer agreement
              against your current process. Define pass/fail criteria before the
              pilot begins.
            </p>
            <p className="sc-fine">
              Not positioned as a regulated decision system. SSO, certifications
              and specialized integrations require separate assessment.
            </p>
          </div>
        </section>
      </main>
    </ShowcaseShell>
  );
}
