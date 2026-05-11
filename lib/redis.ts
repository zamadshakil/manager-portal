import "server-only"
import IORedis, { type Redis } from "ioredis"

// ---------------------------------------------------------------------------
// Railway-native Redis client
// ---------------------------------------------------------------------------
//
// Migrated off `@upstash/redis` + `@upstash/ratelimit` because we no longer
// run on Vercel Edge — Railway hosts a persistent Node process that can hold
// long-lived TCP connections, so HTTP-based Upstash is no longer required.
//
// Configuration:
//   - REDIS_URL — full connection string. Railway's Redis plugin exposes this
//     automatically (e.g. `redis://default:<pwd>@<host>:6379` or
//     `rediss://...` for TLS). Set this in the `manager-portal` service.
//
// The client is a lazy singleton: we only connect on the first call to
// `getRedis()`, which keeps cold starts cheap and avoids crashing the build
// when REDIS_URL isn't set in CI.
// ---------------------------------------------------------------------------

let _redis: Redis | null = null
let _initFailed = false

export function getRedis(): Redis | null {
  if (_redis) return _redis
  if (_initFailed) return null

  const url = process.env.REDIS_URL
  if (!url) return null

  try {
    _redis = new IORedis(url, {
      // Keep retry storms bounded — we'd rather fail a single request fast
      // than hold the route hostage while ioredis backs off.
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      // Open the socket on first command instead of at import time. Important
      // for Next.js, where this module loads in many worker contexts.
      lazyConnect: true,
      // Reconnect with exponential-ish backoff capped at 2s.
      retryStrategy: (times) => Math.min(times * 200, 2000),
    })

    _redis.on("error", (err) => {
      // Don't crash the process — individual command failures are surfaced
      // by the caller via try/catch and the limiter's fail-closed branch.
      console.error("[redis] client error:", err.message)
    })

    return _redis
  } catch (err) {
    console.error("[redis] failed to init from REDIS_URL", err)
    _initFailed = true
    return null
  }
}

// ---------------------------------------------------------------------------
// Sliding-window rate limiter (Redis sorted set implementation)
// ---------------------------------------------------------------------------
//
// Algorithm:
//   1. ZREMRANGEBYSCORE drops entries older than (now - windowMs).
//   2. ZADD inserts the current request with `now` as the score.
//   3. ZCARD returns the live request count inside the window.
//   4. PEXPIRE refreshes the key TTL so empty buckets eventually disappear.
//
// All four commands run in a single MULTI pipeline → one round-trip per
// `.limit()` call, atomic with respect to other limiter writes.
//
// The result shape matches what `@upstash/ratelimit` returned, so all
// existing callers (`{ success }` destructuring, etc.) keep working.
// ---------------------------------------------------------------------------

export type LimitResult = {
  success: boolean
  limit: number
  remaining: number
  reset: number
}

class SlidingWindowLimiter {
  constructor(
    private readonly prefix: string,
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {}

  async limit(identifier: string): Promise<LimitResult> {
    const now = Date.now()
    const reset = now + this.windowMs
    const redis = getRedis()

    if (!redis) return mockLimitResult(this.maxRequests, reset)

    const key = `${this.prefix}:${identifier}`
    const windowStart = now - this.windowMs
    // Unique member so concurrent requests in the same millisecond don't
    // collide and silently dedupe inside the sorted set.
    const member = `${now}-${Math.random().toString(36).slice(2, 10)}`

    try {
      const pipeline = redis.multi()
      pipeline.zremrangebyscore(key, 0, windowStart)
      pipeline.zadd(key, now, member)
      pipeline.zcard(key)
      pipeline.pexpire(key, this.windowMs)
      const results = await pipeline.exec()

      if (!results) throw new Error("redis pipeline.exec() returned null")

      // results[2] is the [err, value] tuple from ZCARD.
      const zcardResult = results[2]
      const count = typeof zcardResult?.[1] === "number" ? zcardResult[1] : 0

      const success = count <= this.maxRequests
      const remaining = Math.max(0, this.maxRequests - count)

      return { success, limit: this.maxRequests, remaining, reset }
    } catch (err) {
      // Fail closed in production — we'd rather drop a request than leave a
      // critical security control silently disabled by a Redis hiccup.
      console.error(`[redis] limiter '${this.prefix}' error:`, err)
      const isProd = process.env.NODE_ENV === "production"
      return isProd
        ? { success: false, limit: this.maxRequests, remaining: 0, reset }
        : { success: true, limit: this.maxRequests, remaining: this.maxRequests - 1, reset }
    }
  }
}

// Mock result used when REDIS_URL is unset.
//   * dev → fail OPEN so local flows keep working without Redis.
//   * prod → fail CLOSED so a misconfigured deploy can't silently disable
//     rate limiting (preserves H-4 from the security audit).
function mockLimitResult(limit: number, reset: number): LimitResult {
  const isProd = process.env.NODE_ENV === "production"
  console.error(
    "[redis] Rate limiter is NOT active because REDIS_URL is not configured. " +
      (isProd
        ? "Failing CLOSED — requests will be rejected until Redis is wired up."
        : "Failing open in development. Set REDIS_URL before deploying."),
  )
  return isProd
    ? { success: false, limit: 0, remaining: 0, reset }
    : { success: true, limit, remaining: limit - 1, reset }
}

// ---------------------------------------------------------------------------
// Limiter singletons
// ---------------------------------------------------------------------------
// Same windows + identifiers as before so user-facing behaviour is unchanged.

let _uploadLimiter: SlidingWindowLimiter | null = null
export function uploadLimiter() {
  if (!_uploadLimiter) {
    // 20 uploads per user per minute.
    _uploadLimiter = new SlidingWindowLimiter("rl:upload", 20, 60_000)
  }
  return _uploadLimiter
}

let _llmLimiter: SlidingWindowLimiter | null = null
export function llmLimiter() {
  if (!_llmLimiter) {
    // 60 LLM validations per team per minute.
    _llmLimiter = new SlidingWindowLimiter("rl:llm", 60, 60_000)
  }
  return _llmLimiter
}

let _chatLimiter: SlidingWindowLimiter | null = null
export function chatLimiter() {
  if (!_chatLimiter) {
    // 30 chat messages per user per minute.
    _chatLimiter = new SlidingWindowLimiter("rl:chat", 30, 60_000)
  }
  return _chatLimiter
}

let _authLimiter: SlidingWindowLimiter | null = null
export function authLimiter() {
  if (!_authLimiter) {
    // 10 auth actions per IP/email per 10 minutes.
    _authLimiter = new SlidingWindowLimiter("rl:auth", 10, 10 * 60_000)
  }
  return _authLimiter
}

let _messageLimiter: SlidingWindowLimiter | null = null
export function messageLimiter() {
  if (!_messageLimiter) {
    // 60 messages per user per minute — generous for real-time chat, blocks spam.
    _messageLimiter = new SlidingWindowLimiter("rl:msg", 60, 60_000)
  }
  return _messageLimiter
}

// ---------------------------------------------------------------------------
// Upload dedup mutex (Redis SET NX EX)
// ---------------------------------------------------------------------------
//
// Prevents a user from submitting the exact same file bytes twice within the
// dedup window by locking on SHA-256(userId + fileHash). Two simultaneous
// uploads of the same 50 MB PDF (e.g. double-click) no longer waste parse
// budget or create duplicate DB rows.
//
// TTL is 30 seconds — long enough to outlast a concurrent duplicate but
// short enough not to block retries after a legitimate first attempt fails.
//
// acquireUploadLock returns true if the lock was acquired (proceed),
// false if a lock already existed (reject as duplicate).
// ---------------------------------------------------------------------------

const UPLOAD_DEDUP_TTL_S = 30

/**
 * Attempt to acquire an upload dedup lock for `lockKey`.
 * Returns `true` if the lock was acquired; `false` if it already exists.
 * Always returns `true` when Redis is unavailable (fail-open so a Redis
 * outage never blocks legitimate uploads).
 */
export async function acquireUploadLock(lockKey: string): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return true
  try {
    const result = await redis.set(
      `upload:dedup:${lockKey}`,
      "1",
      "EX",
      UPLOAD_DEDUP_TTL_S,
      "NX",
    )
    return result === "OK"
  } catch {
    return true
  }
}

/**
 * Release an upload dedup lock. Call this when the upload has durably
 * succeeded (row inserted in DB) so the user can immediately retry if
 * they want to re-upload the same file intentionally.
 */
export async function releaseUploadLock(lockKey: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.del(`upload:dedup:${lockKey}`)
  } catch {
    // Non-fatal — TTL will expire on its own.
  }
}
