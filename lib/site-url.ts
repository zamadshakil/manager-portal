import "server-only"

const PRODUCTION_SITE_URL = "https://system.zamdevai.com"

function normalizeOrigin(value: string): string {
  return value.replace(/\/+$/, "")
}

export function getCanonicalSiteUrl(): string {
  if (process.env.VERCEL_ENV === "preview") {
    const previewHost = process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL
    if (previewHost) return normalizeOrigin(`https://${previewHost}`)
  }
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (configured) return normalizeOrigin(configured)
  if (process.env.NODE_ENV === "development") return "http://localhost:3000"
  return PRODUCTION_SITE_URL
}

export function getConfiguredSiteUrl(): string | null {
  if (process.env.VERCEL_ENV === "preview") {
    const previewHost = process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL
    if (previewHost) return normalizeOrigin(`https://${previewHost}`)
  }
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (configured) return normalizeOrigin(configured)
  if (process.env.NODE_ENV === "development") return "http://localhost:3000"
  return null
}
