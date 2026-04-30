"use client"

import { useReportWebVitals } from "next/web-vitals"

/**
 * Web Vitals reporter.
 *
 * Streams Core Web Vitals (LCP, INP, CLS, FCP, TTFB) to a server beacon in
 * production so we can correlate field performance with deploys, and logs
 * them to the console in development for quick local feedback.
 *
 * In production we POST to /api/vitals using `navigator.sendBeacon` when
 * available so the request survives page transitions. The endpoint is a
 * thin acknowledgement today; wire it to PostHog/Sentry/Vercel when the
 * analytics destination is decided.
 */
export function WebVitalsReporter() {
  useReportWebVitals((metric) => {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.log("[v0:web-vital]", metric.name, Math.round(metric.value), metric)
      return
    }

    try {
      const body = JSON.stringify({
        name: metric.name,
        value: metric.value,
        rating: metric.rating,
        delta: metric.delta,
        id: metric.id,
        navigationType: metric.navigationType,
        path: window.location.pathname,
      })

      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        const blob = new Blob([body], { type: "application/json" })
        navigator.sendBeacon("/api/vitals", blob)
        return
      }

      void fetch("/api/vitals", {
        method: "POST",
        body,
        headers: { "content-type": "application/json" },
        keepalive: true,
      })
    } catch {
      // Reporting is best-effort and must never throw into the app.
    }
  })

  return null
}
