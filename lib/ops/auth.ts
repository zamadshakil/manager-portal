import crypto from "crypto"

const ALG = "sha256"
const EXPIRY_HOURS = 8

function getSecret(): string | null {
  const configured = process.env.OPS_JWT_SECRET?.trim()
  if (configured) return configured
  return process.env.NODE_ENV === "development"
    ? "ops-dev-secret-change-in-production"
    : null
}

function base64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf) : buf
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

function sign(data: string, secret: string): string {
  return base64url(
    crypto.createHmac(ALG, secret).update(data).digest()
  )
}

export interface OpsTokenPayload {
  sub: string
  iat: number
  exp: number
}

export function signToken(username: string): string {
  const secret = getSecret()
  if (!secret) throw new Error("Ops authentication is not configured")
  const now = Math.floor(Date.now() / 1000)
  const payload: OpsTokenPayload = {
    sub: username,
    iat: now,
    exp: now + EXPIRY_HOURS * 3600,
  }
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const body = base64url(JSON.stringify(payload))
  const sig = sign(`${header}.${body}`, secret)
  return `${header}.${body}.${sig}`
}

export function verifyToken(token: string): OpsTokenPayload | null {
  try {
    const secret = getSecret()
    if (!secret) return null
    const parts = token.split(".")
    if (parts.length !== 3) return null
    const [header, body, sig] = parts
    const expected = sign(`${header}.${body}`, secret)
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
    const payload: OpsTokenPayload = JSON.parse(
      Buffer.from(body, "base64").toString("utf8")
    )
    const now = Math.floor(Date.now() / 1000)
    if (payload.exp < now) return null
    return payload
  } catch {
    return null
  }
}

export function verifyCredentials(username: string, password: string): boolean {
  const expectedUser = process.env.OPS_USERNAME?.trim()
    || (process.env.NODE_ENV === "development" ? "admin" : "")
  const expectedPass = process.env.OPS_PASSWORD
    || (process.env.NODE_ENV === "development" ? "admin123" : "")
  if (!expectedUser || !expectedPass || !getSecret()) return false

  const digest = (value: string) => crypto.createHash("sha256").update(value).digest()
  return crypto.timingSafeEqual(digest(username), digest(expectedUser))
    && crypto.timingSafeEqual(digest(password), digest(expectedPass))
}

export function isOpsAuthConfigured(): boolean {
  return Boolean(getSecret())
    && Boolean(process.env.OPS_USERNAME?.trim() || process.env.NODE_ENV === "development")
    && Boolean(process.env.OPS_PASSWORD || process.env.NODE_ENV === "development")
}
