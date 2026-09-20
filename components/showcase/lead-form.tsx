"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export function LeadForm({
  initialSegment = "agencies",
  ready = false,
}: {
  initialSegment?: string;
  ready?: boolean;
}) {
  const [segment, setSegment] = useState(initialSegment);
  const [consent, setConsent] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const router = useRouter();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!privacy) {
      setError("Please acknowledge the privacy notice.");
      return;
    }
    setPending(true);
    setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const utm = new URLSearchParams(window.location.search);
    try {
      const response = await fetch("/api/funnel/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...data,
          segment,
          privacyAccepted: privacy,
          marketingConsent: consent,
          source: utm.get("utm_source") || "website",
          medium: utm.get("utm_medium") || "direct",
          campaign: utm.get("utm_campaign") || "showcase",
        }),
        signal: AbortSignal.timeout(20000),
      });
      const body = await response.json();
      if (!response.ok || !body.ok)
        throw new Error(body.error || "Please try again.");
      router.push("/showcase/thank-you");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save your request.");
      setPending(false);
    }
  }
  return (
    <form className="sc-form" onSubmit={submit}>
      {!ready && (
        <p className="sc-error" role="status">
          Online intake is being connected. For now, email{" "}
          <a
            className="sc-text-link"
            href="mailto:mail@zamdevai.com?subject=Hierarchia%20workflow%20audit"
          >
            mail@zamdevai.com
          </a>{" "}
          to request your audit.
        </p>
      )}
      <div className="sc-form-row">
        <label>
          Your name
          <input
            name="name"
            autoComplete="name"
            required
            minLength={2}
            maxLength={100}
          />
        </label>
        <label>
          Work email
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
          />
        </label>
      </div>
      <label>
        Company
        <input
          name="company"
          autoComplete="organization"
          required
          minLength={2}
          maxLength={150}
        />
      </label>
      <label htmlFor="segment">
        Your team’s work
        <select
          id="segment"
          name="segment"
          value={segment}
          onChange={(e) => setSegment(e.target.value)}
        >
          <option value="agencies">Agency / BPO</option>
          <option value="ecommerce">Ecommerce operations</option>
          <option value="training">Training operations</option>
          <option value="other">Another workflow</option>
        </select>
      </label>
      <div className="sc-form-row">
        <label>
          Team size
          <input
            name="teamSize"
            type="number"
            min={1}
            max={100000}
            step={1}
            required
            placeholder="e.g. 30"
          />
        </label>
        <label>
          Submissions per week
          <input
            name="weeklySubmissions"
            type="number"
            min={1}
            max={100000}
            step={1}
            required
            placeholder="e.g. 80"
          />
        </label>
      </div>
      <label>
        What gets reviewed, and where does it slow down?
        <textarea
          name="workflow"
          required
          minLength={10}
          maxLength={1200}
          placeholder="For example: our account leads review weekly reports and return them for missing sources."
        />
      </label>
      <label>
        Preferred times and timezone (optional)
        <input
          name="preferredTime"
          maxLength={200}
          placeholder="Tuesday afternoon, UK time"
        />
      </label>
      <p className="sc-fine">
        Please don’t include passwords, client documents or sensitive personal
        information.
      </p>
      <label className="sc-honey" aria-hidden="true">
        Leave this empty
        <input name="website" tabIndex={-1} autoComplete="off" />
      </label>
      <div className="sc-check">
        <input
          type="checkbox"
          id="privacy"
          checked={privacy}
          onChange={(e) => setPrivacy(e.target.checked)}
        />
        <label htmlFor="privacy">
          I understand ZamDev AI will use these details to respond to my
          request.{" "}
          <Link href="/showcase/privacy" className="sc-text-link">
            Privacy notice
          </Link>
        </label>
      </div>
      <div className="sc-check">
        <input
          type="checkbox"
          id="marketing"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <label htmlFor="marketing">
          Optional: I’d also like practical workflow tips and Hierarchia
          updates. I can unsubscribe at any time.
        </label>
      </div>
      {error && (
        <p className="sc-error" role="alert">
          {error}
        </p>
      )}
      <button className="sc-button" type="submit" disabled={pending || !ready}>
        {pending ? "Saving your request…" : "Request my free workflow audit →"}
      </button>
      <p className="sc-fine">
        This requests a conversation; it does not reserve a calendar slot or
        start a paid subscription.
      </p>
    </form>
  );
}
