"use client";

import { useEffect } from "react";
import { ShowcaseShell } from "@/components/showcase/shell";

export default function Page() {
  useEffect(() => {
    window.location.replace("https://hirarchia.zamdevai.com/auth/login");
  }, []);

  return (
    <ShowcaseShell>
      <main className="sc-wrap sc-page sc-prose" style={{ textAlign: "center", padding: "80px 20px" }}>
        <p className="sc-eyebrow">REDIRECTING TO LIVE PLATFORM</p>
        <h1 style={{ fontSize: 32, marginBottom: 16 }}>Opening Hierarchia Live Portal...</h1>
        <p className="sc-lead" style={{ maxWidth: 520, margin: "0 auto 24px auto" }}>
          You are being redirected to the live platform at <strong>hirarchia.zamdevai.com</strong>.
        </p>
        <a
          href="https://hirarchia.zamdevai.com/auth/login"
          className="sc-button"
          style={{ display: "inline-flex" }}
        >
          Click here if not redirected automatically &rarr;
        </a>
      </main>
    </ShowcaseShell>
  );
}
