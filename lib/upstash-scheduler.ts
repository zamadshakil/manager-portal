import { getRedis } from "@/lib/redis"

/**
 * Cron observability helpers.
 *
 * Historical context: this module used to gate the `mark-missed` cron behind
 * a Redis-tracked 15-minute interval. We now schedule the cron natively
 * via Railway HTTP cron (`GET /api/cron/mark-missed`), so the gate is gone.
 * What remains is a lightweight execution recorder used for monitoring /
 * debugging — backed by the Railway-native Redis instance.
 *
 * The Redis client is resolved lazily inside `recordTaskExecution` so a
 * cold start with a missing `REDIS_URL` never crashes the route — the
 * recorder silently no-ops instead of taking the cron down.
 */

/**
 * Record a cron execution for monitoring. No-ops on Redis errors so a flaky
 * Redis instance does not affect the cron's primary job.
 */
export async function recordTaskExecution(
  taskName: string,
  metadata: Record<string, unknown>,
) {
  try {
    const redis = getRedis()
    if (!redis) {
      console.warn(`[cron] redis not configured, skipping ${taskName} record`)
      return
    }

    const key = `cron:${taskName}:executions`
    const entry = {
      timestamp: new Date().toISOString(),
      ...metadata,
    }
    // Keep last 100 executions. ioredis lpush/ltrim signatures are identical
    // to the previous Upstash REST client, so no caller changes were required.
    await redis.lpush(key, JSON.stringify(entry))
    await redis.ltrim(key, 0, 99)
  } catch (error) {
    console.error(`[cron] Failed to record execution for ${taskName}:`, error)
  }
}
