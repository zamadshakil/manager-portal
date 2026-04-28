import "server-only"
import { Redis } from "@upstash/redis"
import { Ratelimit } from "@upstash/ratelimit"

let _redis: Redis | null = null
export function getRedis() {
  if (_redis) return _redis
  _redis = Redis.fromEnv()
  return _redis
}

let _uploadLimiter: Ratelimit | null = null
export function uploadLimiter() {
  if (_uploadLimiter) return _uploadLimiter
  _uploadLimiter = new Ratelimit({
    redis: getRedis(),
    // 20 uploads per user per 10 minutes — generous but stops accidental loops.
    limiter: Ratelimit.slidingWindow(20, "10 m"),
    analytics: true,
    prefix: "rl:upload",
  })
  return _uploadLimiter
}

let _llmLimiter: Ratelimit | null = null
export function llmLimiter() {
  if (_llmLimiter) return _llmLimiter
  _llmLimiter = new Ratelimit({
    redis: getRedis(),
    // 60 LLM validations per team per minute.
    limiter: Ratelimit.slidingWindow(60, "1 m"),
    analytics: true,
    prefix: "rl:llm",
  })
  return _llmLimiter
}
