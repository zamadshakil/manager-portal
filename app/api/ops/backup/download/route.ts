import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { verifyToken } from "@/lib/ops/auth"
import { downloadBackup } from "@/lib/ops/storage"

export const dynamic = "force-dynamic"
export const maxDuration = 300

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

  const key = request.nextUrl.searchParams.get("key")
  if (!key || !key.startsWith("backups/db/")) {
    return NextResponse.json({ error: "Invalid backup key" }, { status: 400 })
  }

  try {
    const buffer = await downloadBackup(key)
    const filename = key.split("/").pop() ?? "backup.zip"
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buffer.length),
      },
    })
  } catch (err: any) {
    console.error("[ops/backup/download] failed:", err)
    return NextResponse.json({ error: err.message ?? "Download failed" }, { status: 500 })
  }
}
