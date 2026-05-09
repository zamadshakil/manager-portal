import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { verifyToken } from "@/lib/ops/auth"
import { runRestore } from "@/lib/ops/restore"

export const dynamic = "force-dynamic"
export const maxDuration = 300

async function verifySession(): Promise<boolean> {
  const jar = await cookies()
  const token = jar.get("ops_session")?.value
  if (!token) return false
  return verifyToken(token) !== null
}

export async function POST(request: NextRequest) {
  if (!(await verifySession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const body = await request.json()
    const key: string = body?.key
    if (!key || !key.startsWith("backups/db/")) {
      return NextResponse.json({ error: "Invalid backup key" }, { status: 400 })
    }
    const result = await runRestore(key)
    return NextResponse.json(result)
  } catch (err: any) {
    console.error("[ops/restore] failed:", err)
    return NextResponse.json({ error: err.message ?? "Restore failed" }, { status: 500 })
  }
}
