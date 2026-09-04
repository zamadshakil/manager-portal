import Link from "next/link";
import { ShowcaseShell } from "@/components/showcase/shell";
export const metadata = { title: "Choose your guest walkthrough | Hierarchia" };
export default function Page() {
  return (
    <ShowcaseShell>
      <main className="sc-wrap sc-page sc-prose">
        <p className="sc-eyebrow">EXPLORE HIERARCHIA</p>
        <h1>Choose a guest walkthrough.</h1>
        <p className="sc-lead">
          No password required. Explore the submission workflow with sample
          data.
        </p>
        <div className="sc-actions">
          <Link className="sc-button" href="/showcase/demo">
            Guest manager →
          </Link>
          <Link className="sc-button secondary" href="/showcase/demo/member">
            Guest member →
          </Link>
        </div>
        <p>
          This is a simulation, not an authenticated live portal. Changes reset
          when the page reloads; no client files or AI requests are involved.
        </p>
      </main>
    </ShowcaseShell>
  );
}
