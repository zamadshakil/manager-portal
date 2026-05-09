import { type NextRequest, NextResponse } from "next/server"

function clearAndRedirect(request: NextRequest) {
  const loginUrl = new URL("/ops/login", request.url)
  const response = NextResponse.redirect(loginUrl, { status: 303 })
  response.cookies.set("ops_session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 0,
    path: "/",
  })
  return response
}

export async function POST(request: NextRequest) {
  return clearAndRedirect(request)
}

export async function GET(request: NextRequest) {
  return clearAndRedirect(request)
}
