import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { verifyToken } from "@/lib/ops/auth"
import { listErrorLogs, getErrorGroups } from "@/lib/system"

export const dynamic = "force-dynamic"

async function verifySession(): Promise<boolean> {
  const jar = await cookies()
  const token = jar.get("ops_session")?.value
  if (!token) return false
  return verifyToken(token) !== null
}

export async function GET(request: NextRequest) {
  if (!(await verifySession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const sp = request.nextUrl.searchParams
  const view = sp.get("view") ?? "logs"

  try {
    if (view === "groups") {
      const groups = await getErrorGroups()
      return NextResponse.json({ groups })
    }
    const { rows, total } = await listErrorLogs({
      severity: (sp.get("severity") as any) || undefined,
      source: sp.get("source") || undefined,
      unresolvedOnly: sp.get("unresolved") === "1",
      limit: Math.min(Number(sp.get("limit") || "50"), 200),
      offset: Number(sp.get("offset") || "0"),
    })
    return NextResponse.json({ rows, total })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
