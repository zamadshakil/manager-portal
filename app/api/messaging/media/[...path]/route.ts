import { NextRequest, NextResponse } from "next/server"
import { getByKey } from "@/lib/r2"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params
  if (!path || path.length === 0) {
    return new NextResponse("Bad Request", { status: 400 })
  }
  const key = path.join("/")

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 })
  }

  try {
    const result = await getByKey(key)
    return new NextResponse(result.stream, {
      headers: {
        "Content-Type": result.blob.contentType || "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (err) {
    console.warn("[messaging-media] Failed to stream key:", key, err)
    return new NextResponse("Not Found", { status: 404 })
  }
}
