import { ShowcaseShell } from "@/components/showcase/shell";
import { Demo } from "@/components/showcase/demo";
export const metadata = {
  title: "Interactive sample workspace | Hierarchia",
  robots: { index: false, follow: true },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const q = await searchParams;
  return (
    <ShowcaseShell>
      <main className="sc-wrap sc-page">
        <Demo initialRole={q.role === "member" ? "member" : "manager"} />
      </main>
    </ShowcaseShell>
  );
}
