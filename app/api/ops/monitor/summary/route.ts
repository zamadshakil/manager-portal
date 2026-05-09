import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { verifyToken } from "@/lib/ops/auth"
import { getSystemHealthSummary, getErrorGroups } from "@/lib/system"

export const dynamic = "force-dynamic"

async function verifySession(): Promise<boolean> {
  const jar = await cookies()
  const token = jar.get("ops_session")?.value
  if (!token) return false
  return verifyToken(token) !== null
}

export async function GET() {
  if (!(await verifySession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const [summary, groups] = await Promise.all([
      getSystemHealthSummary(),
      getErrorGroups(),
    ])
    const openIssues = groups.filter((g) => !g.resolved).length
    return NextResponse.json({ ...summary, open_issues: openIssues })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
