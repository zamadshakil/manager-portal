import { redirect } from "next/navigation"
import { getCurrentProfile } from "@/lib/auth"

export const dynamic = "force-dynamic"

export default async function RootPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect("/auth/login")
  redirect("/dashboard")
}
