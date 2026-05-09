import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { verifyToken } from "@/lib/ops/auth"
import { listBackups } from "@/lib/ops/storage"

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
    const backups = await listBackups()
    return NextResponse.json({ backups })
  } catch (err: any) {
    console.error("[ops/backups] failed:", err)
    return NextResponse.json({ error: err.message ?? "Failed to list backups" }, { status: 500 })
  }
}
