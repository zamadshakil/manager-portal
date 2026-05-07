import { type NextRequest, NextResponse } from "next/server"

/**
 * Web Vitals collector.
 *
 * The client posts beacon-friendly JSON payloads for each Core Web Vital
 * sample. We acknowledge with 204 immediately — this is the obvious place
 * to forward to PostHog, Sentry, or a custom warehouse later. We avoid
 * doing any heavy work synchronously so beacons never block the next
 * navigation.
 */
// M-3: Cheap-but-real abuse mitigation for the unauthenticated vitals
// endpoint:
//   * Drop requests without a same-origin Origin / Referer (browsers always
//     send one for fetch + sendBeacon).
//   * Cap the body size so an attacker cannot use this endpoint to make us
//     buffer arbitrary payloads.
const MAX_VITALS_BODY = 16 * 1024 // 16 KB is plenty for a CWV beacon

export async function POST(request: NextRequest) {
  const canonical = process.env.NEXT_PUBLIC_SITE_URL
  if (canonical) {
    const origin = request.headers.get("origin")
    const referer = request.headers.get("referer")
    const originOk = !origin || origin === canonical
    const refererOk = !referer || referer.startsWith(canonical + "/")
    if (!originOk || !refererOk) {
      return new NextResponse(null, { status: 204 })
    }
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0")
  if (Number.isFinite(contentLength) && contentLength > MAX_VITALS_BODY) {
    return new NextResponse(null, { status: 413 })
  }

  try {
    // Drain the body (capped) so the beacon completes cleanly. If/when we
    // wire a real sink, replace with `await request.json()` and forward.
    void request.text()
  } catch {
    // Swallow — collection must never error the app.
  }
  return new NextResponse(null, { status: 204 })
}
