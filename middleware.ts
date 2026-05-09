import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { verifyToken } from "@/lib/ops/auth"

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (!pathname.startsWith("/ops")) {
    return NextResponse.next()
  }

  if (pathname === "/ops/login" || pathname.startsWith("/ops/login/")) {
    return NextResponse.next()
  }

  const token = request.cookies.get("ops_session")?.value
  if (!token) {
    const loginUrl = new URL("/ops/login", request.url)
    loginUrl.searchParams.set("from", pathname)
    return NextResponse.redirect(loginUrl)
  }

  const payload = verifyToken(token)
  if (!payload) {
    const loginUrl = new URL("/ops/login", request.url)
    loginUrl.searchParams.set("from", pathname)
    const response = NextResponse.redirect(loginUrl)
    response.cookies.delete("ops_session")
    return response
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/ops/:path*"],
}
