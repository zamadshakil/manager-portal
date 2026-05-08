import { type NextRequest, NextResponse } from "next/server"
import { proxy } from "@/proxy"

export async function middleware(request: NextRequest) {
  const traceId = crypto.randomUUID().replace(/-/g, "")

  // Run session refresh (auth proxy)
  const response = await proxy(request)

  // Inject observability headers on the response so downstream code can read
  // them via `headers()`. Also forward them on the request clone so server
  // components can read the trace ID from `headers()`.
  const res = response ?? NextResponse.next()
  res.headers.set("x-trace-id", traceId)
  res.headers.set("x-pathname", request.nextUrl.pathname)

  return res
}

export const config = {
  matcher: [
    "/((?!api/cron|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
}
