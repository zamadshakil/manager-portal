import { NextResponse } from "next/server"

/**
 * Web Vitals collector.
 *
 * The client posts beacon-friendly JSON payloads for each Core Web Vital
 * sample. We acknowledge with 204 immediately — this is the obvious place
 * to forward to PostHog, Sentry, or a custom warehouse later. We avoid
 * doing any heavy work synchronously so beacons never block the next
 * navigation.
 */
export async function POST(request: Request) {
  try {
    // We intentionally don't `await` parsing; we just drain the body so the
    // client beacon completes cleanly. If/when we wire a real sink, replace
    // this with `await request.json()` and forward to the destination.
    void request.text()
  } catch {
    // Swallow — collection must never error the app.
  }
  return new NextResponse(null, { status: 204 })
}
