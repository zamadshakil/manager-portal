import Link from "next/link";
import { ShowcaseShell } from "@/components/showcase/shell";
export const metadata = {
  title: "Next steps | Hierarchia",
  robots: { index: false, follow: false },
};
export default function Page() {
  return (
    <ShowcaseShell>
      <main className="sc-wrap sc-page sc-prose">
        <p className="sc-eyebrow">YOUR NEXT STEP</p>
        <h1>Bring one workflow. We’ll map it together.</h1>
        <p className="sc-lead">
          If you just completed the form, your request has been saved for the
          ZamDev AI team. We’ll contact you by email to agree a time. No meeting
          is booked until we confirm it.
        </p>
        <ul className="sc-list">
          <li>
            Pick one recurring submission, such as a report or content batch.
          </li>
          <li>Estimate how many arrive each week.</li>
          <li>List the three checks your manager repeats most often.</li>
        </ul>
        <div className="sc-actions">
          <Link className="sc-button" href="/showcase/demo">
            Explore the sample workspace →
          </Link>
          <Link
            className="sc-text-link"
            href="/showcase/resources/workflow-map"
          >
            Get the workflow worksheet
          </Link>
        </div>
        <p className="sc-fine">
          Questions? <a href="mailto:mail@zamdevai.com">mail@zamdevai.com</a>
        </p>
      </main>
    </ShowcaseShell>
  );
}
