"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { isOpsAuthConfigured, signToken, verifyCredentials } from "@/lib/ops/auth"

export async function loginAction(formData: FormData) {
  if (!isOpsAuthConfigured()) {
    redirect("/ops/login?error=unconfigured")
  }

  const username = (formData.get("username") as string ?? "").trim()
  const password = (formData.get("password") as string ?? "")

  if (!verifyCredentials(username, password)) {
    redirect("/ops/login?error=invalid")
  }

  const token = signToken(username)
  const jar = await cookies()
  jar.set("ops_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 8 * 60 * 60,
    path: "/",
  })

  redirect("/ops")
}
