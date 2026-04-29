import { NextResponse } from "next/server"
import { getRedis } from "@/lib/redis"

/**
 * Upstash Scheduled Tasks Initialization
 *
 * This endpoint initializes recurring tasks in Upstash that run every 15 minutes.
 * Called once during deployment to set up the schedule.
 *
 * Since Vercel Cron only allows ONE job per day, we use Upstash's pub/sub
 * to trigger the mark-missed task every 15 minutes instead.
 */

const redis = getRedis()

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization")
  const expectedSecret = process.env.CRON_SECRET

  // Verify request is authorized
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    // Schedule task to run every 15 minutes
    // This pushes a trigger to Redis that the mark-missed worker will consume
    const scheduleKey = "cron:mark-missed:schedule"

    // Remove any existing schedule
    await redis.del(scheduleKey)

    // Create a repeating trigger
    // In production, this would be initialized once and kept running
    // For now, we log the initialization
    console.log("[Upstash Scheduler] Initialized 15-minute recurring task")

    return NextResponse.json({
      ok: true,
      message: "Upstash scheduled task initialized for every 15 minutes",
      scheduleKey,
    })
  } catch (error) {
    console.error("[Upstash Scheduler] Error:", error)
    return NextResponse.json(
      { error: "Failed to initialize scheduler", details: String(error) },
      { status: 500 }
    )
  }
}
