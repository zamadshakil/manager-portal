import { NextResponse } from "next/server"

/**
 * Web Vitals collector.
 *
 * The client `WebVitalsReporter` posts Core Web Vitals samples here via
 * `navigator.sendBeacon`. We intentionally accept-and-drop today — the
 * endpoint exists so the beacon never 404s and so adding a real analytics
 * sink (PostHog, Sentry, your own ClickHouse, Vercel Analytics' event API)
 * is a single-file change.
 *
 * Runs on the Edge runtime: beacon traffic from every page load shouldn't
 * touch a Node Lambda, and the Edge has the lowest latency for an ack-only
 * endpoint.
 */
export const runtime = "edge"

export async function POST(req: Request) {
  // Drain the body so the connection closes cleanly on every browser. We
  // ignore parsing errors — partial beacons during page unload are normal.
  try {
    await req.text()
  } catch {
    /* ignore */
  }
  return new NextResponse(null, { status: 204 })
}
