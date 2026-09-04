import { ShowcaseShell } from "@/components/showcase/shell";
import { Calculator } from "@/components/showcase/calculator";
export const metadata = { title: "Review workload calculator | Hierarchia" };
export default function Page() {
  return (
    <ShowcaseShell>
      <main className="sc-wrap sc-page">
        <p className="sc-eyebrow">MAKE THE WORKLOAD VISIBLE</p>
        <h1>How much time goes into review?</h1>
        <p className="sc-lead" style={{ marginBottom: 35 }}>
          Use your own numbers to estimate the weekly effort. No email required.
        </p>
        <Calculator />
      </main>
    </ShowcaseShell>
  );
}
