import "server-only"
import { NextResponse } from "next/server"
import { getRedis } from "@/lib/redis"

export type ApiRateLimitOptions = {
  prefix: string
  limit: number
  windowMs: number
}

function getClientIp(request: Request): string {
  const headers = request.headers
  const cfIp = headers.get("cf-connecting-ip")
  if (cfIp) return cfIp

  const forwardedFor = headers.get("x-forwarded-for")
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim() || "unknown"

  const realIp = headers.get("x-real-ip")
  if (realIp) return realIp

  return "unknown"
}

export async function enforceApiRateLimit(
  request: Request,
  options: ApiRateLimitOptions,
): Promise<NextResponse | null> {
  const reset = Date.now() + options.windowMs
  const redis = getRedis()

  if (!redis) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "Rate limiter is not configured." },
        { status: 503, headers: { "retry-after": String(Math.ceil(options.windowMs / 1000)) } },
      )
    }
    return null
  }

  const ip = getClientIp(request)
  const path = new URL(request.url).pathname
  const key = `${options.prefix}:${ip}:${path}`
  const now = Date.now()
  const windowStart = now - options.windowMs
  const member = `${now}-${Math.random().toString(36).slice(2, 10)}`

  try {
    const pipeline = redis.multi()
    pipeline.zremrangebyscore(key, 0, windowStart)
    pipeline.zadd(key, now, member)
    pipeline.zcard(key)
    pipeline.pexpire(key, options.windowMs)
    const results = await pipeline.exec()
    const countResult = results?.[2]
    const count = typeof countResult?.[1] === "number" ? countResult[1] : 0

    if (count > options.limit) {
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: {
            "retry-after": String(Math.ceil(options.windowMs / 1000)),
            "x-ratelimit-limit": String(options.limit),
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(reset),
          },
        },
      )
    }

    return null
  } catch (err) {
    console.error(`[rate-limit] ${options.prefix} failed:`, err)
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "Rate limiter unavailable" },
        { status: 503, headers: { "retry-after": "30" } },
      )
    }
    return null
  }
}
