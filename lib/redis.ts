import "server-only"
import { Redis } from "@upstash/redis"
import { Ratelimit } from "@upstash/ratelimit"

let _redis: Redis | null = null
export function getRedis(): Redis | null {
  if (_redis) return _redis
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null
  }
  try {
    _redis = Redis.fromEnv()
    return _redis
  } catch (err) {
    console.warn("[redis] failed to init from env", err)
    return null
  }
}

// H-4: Mock limiter used when Redis is not configured.
//
//   * In development we fail OPEN so the local flow keeps working without
//     Upstash credentials — but emit a loud warning every call.
//   * In production we fail CLOSED. Returning success: false forces every
//     rate-limited route to reject the request rather than silently disable
//     a critical security control. Set UPSTASH_REDIS_REST_URL + TOKEN
//     in the deployment environment to restore real limiting.
const mockLimiter = {
  limit: async (_identifier: string) => {
    const isProd = process.env.NODE_ENV === "production"
    console.error(
      "[redis] Rate limiter is NOT active because UPSTASH_REDIS_REST_URL / " +
        "UPSTASH_REDIS_REST_TOKEN are not configured. " +
        (isProd
          ? "Failing CLOSED — requests will be rejected until Redis is wired up."
          : "Failing open in development. Set the env vars before deploying."),
    )
    return isProd
      ? { success: false, limit: 0, remaining: 0, reset: Date.now() + 60_000 }
      : { success: true, limit: 100, remaining: 99, reset: Date.now() + 60_000 }
  },
}

let _uploadLimiter: Ratelimit | null = null
export function uploadLimiter() {
  const r = getRedis()
  if (!r) return mockLimiter
  if (_uploadLimiter) return _uploadLimiter
  _uploadLimiter = new Ratelimit({
    redis: r,
    // 20 uploads per user per minute
    limiter: Ratelimit.slidingWindow(20, "1 m"),
    analytics: true,
    prefix: "rl:upload",
  })
  return _uploadLimiter
}

let _llmLimiter: Ratelimit | null = null
export function llmLimiter() {
  const r = getRedis()
  if (!r) return mockLimiter
  if (_llmLimiter) return _llmLimiter
  _llmLimiter = new Ratelimit({
    redis: r,
    // 60 LLM validations per team per minute.
    limiter: Ratelimit.slidingWindow(60, "1 m"),
    analytics: true,
    prefix: "rl:llm",
  })
  return _llmLimiter
}

let _chatLimiter: Ratelimit | null = null
export function chatLimiter() {
  const r = getRedis()
  if (!r) return mockLimiter
  if (_chatLimiter) return _chatLimiter
  _chatLimiter = new Ratelimit({
    redis: r,
    // 30 chat messages per user per minute
    limiter: Ratelimit.slidingWindow(30, "1 m"),
    analytics: true,
    prefix: "rl:chat",
  })
  return _chatLimiter
}

let _authLimiter: Ratelimit | null = null
export function authLimiter() {
  const r = getRedis()
  if (!r) return mockLimiter
  if (_authLimiter) return _authLimiter
  _authLimiter = new Ratelimit({
    redis: r,
    // 10 auth actions per IP per 10 minutes
    limiter: Ratelimit.slidingWindow(10, "10 m"),
    analytics: true,
    prefix: "rl:auth",
  })
  return _authLimiter
}
