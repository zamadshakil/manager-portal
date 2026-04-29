import { getRedis } from "@/lib/redis"

/**
 * Upstash Scheduler Utility
 *
 * Manages 15-minute interval scheduling for the mark-missed cron task.
 * Since Vercel Cron only allows one job per day, we use Upstash Redis
 * to trigger task marking every 15 minutes.
 *
 * Uses the shared `getRedis()` factory from `lib/redis` so the entire app
 * shares a single Upstash Redis client (and a single TLS connection pool)
 * instead of constructing a new one per module.
 */
const redis = getRedis()

/**
 * Initialize the 15-minute recurring schedule in Upstash
 * This should be called once during deployment
 */
export async function initializeSchedule() {
  try {
    const scheduleKey = "cron:mark-missed:last-run"
    const intervalMs = 15 * 60 * 1000 // 15 minutes

    // Set initial timestamp
    const now = Date.now()
    await redis.set(scheduleKey, now, { ex: 3600 }) // Expire after 1 hour

    console.log("[Upstash] Schedule initialized for 15-minute intervals")
    return { success: true, interval: intervalMs }
  } catch (error) {
    console.error("[Upstash] Failed to initialize schedule:", error)
    throw error
  }
}

/**
 * Check if 15 minutes have passed since last execution
 * Use this in your API route to gate execution
 */
export async function shouldRunCronTask(): Promise<boolean> {
  try {
    const scheduleKey = "cron:mark-missed:last-run"
    const intervalMs = 15 * 60 * 1000 // 15 minutes

    const lastRun = await redis.get<number>(scheduleKey)
    const now = Date.now()

    if (!lastRun) {
      // First run
      await redis.set(scheduleKey, now, { ex: 3600 })
      return true
    }

    if (now - lastRun >= intervalMs) {
      // 15 minutes have passed
      await redis.set(scheduleKey, now, { ex: 3600 })
      return true
    }

    return false
  } catch (error) {
    console.error("[Upstash] Error checking schedule:", error)
    // Fail open - allow execution if Redis check fails
    return true
  }
}

/**
 * Record task execution for monitoring
 */
export async function recordTaskExecution(
  taskName: string,
  metadata: Record<string, any>
) {
  try {
    const key = `cron:${taskName}:executions`
    const entry = {
      timestamp: new Date().toISOString(),
      ...metadata,
    }

    // Keep last 100 executions
    await redis.lpush(key, JSON.stringify(entry))
    await redis.ltrim(key, 0, 99)
  } catch (error) {
    console.error(`[Upstash] Failed to record execution for ${taskName}:`, error)
  }
}

