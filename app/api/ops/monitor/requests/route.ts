import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { verifyToken } from "@/lib/ops/auth"
import { listRequestLogs, getTopPaths, getRequestVolumeByHour } from "@/lib/system"

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
    if (view === "top-paths") {
      const paths = await getTopPaths(20)
      return NextResponse.json({ paths })
    }
    if (view === "volume") {
      const volume = await getRequestVolumeByHour()
      return NextResponse.json({ volume })
    }
    const { rows, total } = await listRequestLogs({
      method: sp.get("method") || undefined,
      minStatus: sp.get("min_status") ? Number(sp.get("min_status")) : undefined,
      pathContains: sp.get("path") || undefined,
      limit: Math.min(Number(sp.get("limit") || "50"), 200),
      offset: Number(sp.get("offset") || "0"),
    })
    return NextResponse.json({ rows, total })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
