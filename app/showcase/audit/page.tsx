import { ShowcaseShell } from "@/components/showcase/shell";
import { LeadForm } from "@/components/showcase/lead-form";
export const metadata = { title: "Request a workflow audit | Hierarchia" };
export const dynamic = "force-dynamic";
export default async function Audit({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const q = await searchParams;
  const segment = ["agencies", "ecommerce", "training", "other"].includes(
    q.segment || "",
  )
    ? q.segment
    : "agencies";
  const ready =
    process.env.FUNNEL_FORMS_ENABLED === "true" &&
    !!process.env.BREVO_API_KEY &&
    Number(process.env.BREVO_FUNNEL_AUDIT_LIST_ID) > 0;
  return (
    <ShowcaseShell>
      <main className="sc-wrap sc-page sc-form-layout">
        <div>
          <p className="sc-eyebrow">THE FIRST STEP IS A CONVERSATION</p>
          <h1>Let’s find the friction in your review process.</h1>
          <p className="sc-lead">
            In a free 20-minute workflow audit, we’ll map one handoff and see
            whether Hierarchia is a good fit.
          </p>
          <ul className="sc-list">
            <li>Where submissions arrive and who owns them</li>
            <li>Which checks managers repeat every week</li>
            <li>How revisions and late work are handled</li>
            <li>What a useful, measurable pilot would look like</li>
          </ul>
          <div className="sc-panel">
            <strong>No sales theatre. One concrete workflow.</strong>
            <p>
              You don’t need to share confidential files. An anonymized example
              and a rough idea of volume are enough.
            </p>
          </div>
        </div>
        <div className="sc-panel">
          <LeadForm initialSegment={segment} ready={ready} />
        </div>
      </main>
    </ShowcaseShell>
  );
}
