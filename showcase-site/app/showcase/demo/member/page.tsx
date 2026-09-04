import { ShowcaseShell } from "@/components/showcase/shell";
import { Demo } from "@/components/showcase/demo";
export const metadata = { title: "Guest member walkthrough | Hierarchia" };
export default function Page() {
  return (
    <ShowcaseShell>
      <main className="sc-wrap sc-page">
        <Demo initialRole="member" />
      </main>
    </ShowcaseShell>
  );
}
