import { resolve4, resolve6, resolveMx } from "node:dns/promises"
import { z } from "zod"

const EmailInputSchema = z
  .string()
  .trim()
  .min(1, "Email is required")
  .max(320, "Email address is too long")
  .email("Enter a valid email address")
  .transform((value) => value.toLowerCase())

const COMMON_EMAIL_DOMAIN_TYPOS = new Map<string, string>([
  ["gamil.com", "gmail.com"],
  ["gmial.com", "gmail.com"],
  ["gmai.com", "gmail.com"],
  ["gmail.co", "gmail.com"],
  ["gmail.con", "gmail.com"],
  ["hotnail.com", "hotmail.com"],
  ["hotmai.com", "hotmail.com"],
  ["hotmial.com", "hotmail.com"],
  ["outlok.com", "outlook.com"],
  ["outllok.com", "outlook.com"],
  ["otulook.com", "outlook.com"],
  ["yaho.com", "yahoo.com"],
  ["yahoo.co", "yahoo.com"],
  ["yahho.com", "yahoo.com"],
  ["iclod.com", "icloud.com"],
  ["icloud.co", "icloud.com"],
])

const RESERVED_EMAIL_DOMAINS = new Set([
  "example.com",
  "example.net",
  "example.org",
  "localhost",
])

type EmailDomainStatus = "deliverable" | "invalid" | "unknown"

const EMAIL_DOMAIN_CACHE_TTL_MS = 10 * 60 * 1000
const emailDomainStatusCache = new Map<string, { expiresAt: number; status: EmailDomainStatus }>()

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const timeoutError = new Error("DNS lookup timed out") as Error & { code?: string }
      timeoutError.code = "DNS_TIMEOUT"
      reject(timeoutError)
    }, timeoutMs)

    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function getDnsErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null
  const code = "code" in error ? error.code : null
  return typeof code === "string" ? code.toUpperCase() : null
}

function getSuggestedEmailAddress(email: string): string | null {
  const atIndex = email.lastIndexOf("@")
  if (atIndex <= 0) return null
  const local = email.slice(0, atIndex)
  const domain = email.slice(atIndex + 1)
  const suggestedDomain = COMMON_EMAIL_DOMAIN_TYPOS.get(domain)
  return suggestedDomain ? `${local}@${suggestedDomain}` : null
}

async function resolveEmailDomainStatus(domain: string): Promise<EmailDomainStatus> {
  const cached = emailDomainStatusCache.get(domain)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.status
  }

  const lookups = await Promise.allSettled([
    withTimeout(resolveMx(domain), 2500),
    withTimeout(resolve4(domain), 2500),
    withTimeout(resolve6(domain), 2500),
  ])

  const hasMailRoute = lookups.some(
    (result) => result.status === "fulfilled" && result.value.length > 0,
  )

  let status: EmailDomainStatus = "unknown"
  if (hasMailRoute) {
    status = "deliverable"
  } else {
    const codes = lookups
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => getDnsErrorCode(result.reason))
      .filter((code): code is string => Boolean(code))

    if (
      codes.length === lookups.length &&
      codes.every((code) => code === "ENOTFOUND" || code === "ENODATA")
    ) {
      status = "invalid"
    }
  }

  emailDomainStatusCache.set(domain, {
    expiresAt: Date.now() + EMAIL_DOMAIN_CACHE_TTL_MS,
    status,
  })

  return status
}

export function normalizeEmailInput(email: string): string {
  return email.trim().toLowerCase()
}

export function parseEmailInput(email: string): { ok: true; email: string } | { ok: false; error: string } {
  const parsed = EmailInputSchema.safeParse(email)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter a valid email address" }
  }

  return { ok: true, email: parsed.data }
}

export async function validateDeliverableEmailAddress(
  email: string,
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const parsed = parseEmailInput(email)
  if (!parsed.ok) {
    return parsed
  }

  const normalized = parsed.email
  const atIndex = normalized.lastIndexOf("@")
  const local = normalized.slice(0, atIndex)
  const domain = normalized.slice(atIndex + 1)

  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return { ok: false, error: "Enter a valid email address" }
  }

  if (
    !domain ||
    domain.length > 255 ||
    domain.includes("..") ||
    RESERVED_EMAIL_DOMAINS.has(domain) ||
    domain.endsWith(".local") ||
    domain.endsWith(".invalid") ||
    domain.endsWith(".example") ||
    domain.endsWith(".test")
  ) {
    return { ok: false, error: "That email domain is not valid for a real inbox." }
  }

  const labels = domain.split(".")
  if (
    labels.length < 2 ||
    labels.some(
      (label) =>
        !label ||
        label.length > 63 ||
        label.startsWith("-") ||
        label.endsWith("-") ||
        !/^[a-z0-9-]+$/i.test(label),
    )
  ) {
    return { ok: false, error: "That email domain is not valid." }
  }

  const suggestion = getSuggestedEmailAddress(normalized)
  if (suggestion) {
    return { ok: false, error: `That email domain looks incorrect. Did you mean ${suggestion}?` }
  }

  const domainStatus = await resolveEmailDomainStatus(domain)
  if (domainStatus === "invalid") {
    return {
      ok: false,
      error: "That email domain does not appear to receive email. Please check the address and try again.",
    }
  }

  // 'unknown' means DNS was inconclusive (timeout, network blip, etc.).
  // Allow the change — only hard-reject when DNS definitively confirms
  // the domain has no mail routing ('invalid' = ENOTFOUND/ENODATA).

  return { ok: true, email: normalized }
}
