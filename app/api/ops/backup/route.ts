import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { verifyToken } from "@/lib/ops/auth"
import { runBackup } from "@/lib/ops/backup"

export const dynamic = "force-dynamic"
export const maxDuration = 300

async function verifySession(): Promise<boolean> {
  const jar = await cookies()
  const token = jar.get("ops_session")?.value
  if (!token) return false
  return verifyToken(token) !== null
}

export async function POST() {
  if (!(await verifySession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const result = await runBackup()
    return NextResponse.json(result)
  } catch (err: any) {
    console.error("[ops/backup] failed:", err)
    return NextResponse.json({ error: err.message ?? "Backup failed" }, { status: 500 })
  }
}
