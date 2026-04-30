"use client"

import { useReportWebVitals } from "next/web-vitals"

/**
 * Per-route Core Web Vitals (LCP, INP, CLS, TTFB, FCP, FID) reporter.
 *
 * In development we log the metric to the console so engineers can see how
 * a change affects perceived speed without leaving the editor.
 *
 * In production we POST to `/api/vitals` using `navigator.sendBeacon` (or a
 * keepalive `fetch` fallback) so the request is never canceled by a tab
 * close. The payload is small enough to fit comfortably under the 64 KB
 * sendBeacon ceiling. Wire `/api/vitals` to your analytics destination
 * (PostHog, Sentry, Vercel Analytics, etc.) when ready — until then the
 * payload is silently dropped on the server side.
 *
 * The reporter renders nothing; it only attaches the listener.
 */
export function WebVitalsReporter() {
  useReportWebVitals((metric) => {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.log("[web-vitals]", metric.name, Math.round(metric.value), metric.id)
      return
    }

    const body = JSON.stringify({
      name: metric.name,
      value: metric.value,
      id: metric.id,
      label: metric.label,
      rating: (metric as { rating?: string }).rating,
      navigationType: (metric as { navigationType?: string }).navigationType,
      path: typeof window !== "undefined" ? window.location.pathname : null,
    })

    try {
      if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
        const blob = new Blob([body], { type: "application/json" })
        navigator.sendBeacon("/api/vitals", blob)
        return
      }
    } catch {
      /* fall through to fetch */
    }

    fetch("/api/vitals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      /* analytics is best-effort; never throw */
    })
  })

  return null
}
