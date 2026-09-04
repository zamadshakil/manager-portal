import { ShowcaseShell } from "@/components/showcase/shell";
export const metadata = { title: "Showcase privacy notice | Hierarchia" };
export default function Page() {
  return (
    <ShowcaseShell>
      <main className="sc-wrap sc-page sc-prose">
        <p className="sc-eyebrow">LAST UPDATED 5 SEPTEMBER 2026</p>
        <h1>Showcase privacy notice</h1>
        <p>
          ZamDev AI operates this Hierarchia showcase. Contact us at{" "}
          <a className="sc-text-link" href="mailto:mail@zamdevai.com">
            mail@zamdevai.com
          </a>{" "}
          about your information.
        </p>
        <h2>What the audit form collects</h2>
        <p>
          Your name, email, company, team size, submission volume, workflow
          description, optional preferred times, source campaign and your
          subscription preference. We use these details to respond to your
          request and assess whether a pilot is appropriate. Please do not
          submit confidential documents or sensitive personal information.
        </p>
        <h2>Where information goes</h2>
        <p>
          Requests are processed by the hosting service and saved in ZamDev AI’s
          Brevo account for follow-up. Infrastructure providers may process
          information in other countries. The public sample workspace does not
          connect to a client database or accept file uploads.
        </p>
        <h2>Marketing is optional</h2>
        <p>
          Requesting an audit does not subscribe you to marketing. If you
          separately request updates, we record that preference. You can ask us
          to stop at any time; marketing emails must include an unsubscribe
          option.
        </p>
        <h2>Technical information</h2>
        <p>
          The host may process basic request and security logs. The calculator
          and sample workspace keep their working state only in the current page
          and reset on reload. We do not place advertising pixels on this
          showcase.
        </p>
        <h2>Retention and requests</h2>
        <p>
          Our operating policy is to review inactive, unqualified inquiries
          after 90 days and delete or anonymize details that are no longer
          needed. This review is manual. Email us to request access, correction,
          deletion or withdrawal of your subscription preference, subject to
          applicable requirements.
        </p>
      </main>
    </ShowcaseShell>
  );
}
