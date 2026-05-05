import { getRedis } from "@/lib/redis"

/**
 * Cron observability helpers.
 *
 * Historical context: this module used to gate the `mark-missed` cron behind
 * a Redis-tracked 15-minute interval. We now schedule the cron natively
 * via the Inngest cron (markMissedCronFn), so the
 * gate is removed. What remains is a lightweight execution recorder used
 * for monitoring / debugging in the Upstash console.
 *
 * The Redis client is resolved lazily inside `recordTaskExecution` so a
 * cold start with missing env vars never crashes the route — the recorder
 * silently no-ops instead of taking the request down.
 */

/**
 * Record a cron execution for monitoring. No-ops on Redis errors so a flaky
 * Upstash quota does not affect the cron's primary job.
 */
export async function recordTaskExecution(
  taskName: string,
  metadata: Record<string, unknown>,
) {
  let redis: ReturnType<typeof getRedis>
  try {
    redis = getRedis()
    if (!redis) {
      console.warn(`[Upstash] redis not configured, skipping ${taskName} record`)
      return
    }
  } catch (err) {
    console.warn(`[Upstash] redis not configured, skipping ${taskName} record`, err)
    return
  }

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
