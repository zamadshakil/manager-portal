/** @type {import('next').NextConfig} */
//
// Build the list of origins that may invoke Server Actions on this deployment.
// Next.js compares the request's `Origin` to its `Host` and rejects mismatches
// with 403 ("Invalid Server Actions request") as a CSRF guard. Behind the
// Railway reverse proxy the Node process sees an internal hostname in `Host`
// while the browser sends `Origin: https://<public-domain>`, so the guard
// fires on every Server Action POST (notably file uploads) unless we
// explicitly allow the public origin here.
//
// We seed the list from NEXT_PUBLIC_SITE_URL (the canonical public domain)
// and also allow `*.railway.app` so Railway preview deployments work without
// per-environment config.
const allowedServerActionOrigins = (() => {
  const origins = new Set(["*.railway.app"])
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  if (siteUrl) {
    try {
      origins.add(new URL(siteUrl).host)
    } catch {
      // Ignore malformed env values — production startup will catch this.
    }
  }
  return [...origins]
})()

const nextConfig = {
  output: "standalone",
  // Server Actions in Next.js cap request bodies at 1 MB by default. Our UI
  // advertises 25 MB document uploads, so we raise the limit. Long-term we
  // intend to move to a client-token flow that streams browser→
  // Blob without traversing the server, but until then this prevents 413s.
  experimental: {
    serverActions: {
      bodySizeLimit: "110mb",
      allowedOrigins: allowedServerActionOrigins,
    },
    // ------------------------------------------------------------------
    // Client-side Router Cache TTLs.
    //
    // In Next 16 the default `dynamic` TTL is 0s, which means every tab
    // click re-fetches the RSC payload from the server even on back/forward
    // navigation. Setting it to 30s gives us instant tab-to-tab navigation
    // for pages the user just visited, while still re-validating on a
    // longer interval. `static` is bumped in line so prefetched routes
    // also stay warm.
    // ------------------------------------------------------------------
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
    // ------------------------------------------------------------------
    // Tree-shake icon and date libraries that we import individually.
    // Without this, `import { Plus } from "lucide-react"` pulls the whole
    // 1k+ icon barrel file into the bundle. With it, Next rewrites the
    // import to the specific module path.
    // ------------------------------------------------------------------
    optimizePackageImports: ["lucide-react", "date-fns", "recharts"],
  },
  serverExternalPackages: ["unpdf", "mammoth", "officeparser", "@napi-rs/canvas"],

  async headers() {
    const isDev = process.env.NODE_ENV === "development"

    // Derive the Supabase origin (and matching ws origin) from the public env
    // var so CSP works for both hosted Supabase (*.supabase.co) and a
    // self-hosted gateway (e.g. Kong on Railway). Falls back to the hosted
    // wildcards when the var is unset (e.g. during `next lint`).
    const r2StorageOrigin = process.env.R2_ACCOUNT_ID
      ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
      : "https://*.r2.cloudflarestorage.com"

    const supabaseOrigins = (() => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      if (!url) return ["https://*.supabase.co", "wss://*.supabase.co"]
      try {
        const u = new URL(url)
        const httpOrigin = `${u.protocol}//${u.host}`
        const wsOrigin = `${u.protocol === "https:" ? "wss:" : "ws:"}//${u.host}`
        return [httpOrigin, wsOrigin]
      } catch {
        return ["https://*.supabase.co", "wss://*.supabase.co"]
      }
    })()

    const security = [
      {
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        // L-1: Extended Permissions-Policy — restrict additional browser features
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(), usb=(), clipboard-read=(self)",
      },
      {
        // H-1: Hardened CSP.
        // - script-src: removed 'unsafe-eval' in production (kept only in dev for Next.js HMR)
        // - Added object-src 'none', base-uri 'self', form-action 'self'
        // - M-11: Tightened connect-src wildcards (operators should replace * with specific hosts)
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          isDev
            ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.cloudflareinsights.com"
            : "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "img-src 'self' blob: data: https://*.r2.dev",
          "media-src 'self' https://*.r2.dev",
          "font-src 'self' https://fonts.gstatic.com https://frontend-cdn.perplexity.ai",
          `connect-src 'self' ${supabaseOrigins.join(" ")} https://*.r2.dev ${r2StorageOrigin} https://cloudflareinsights.com`,
          "frame-src 'self' blob:",
          "frame-ancestors 'none'",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join("; "),
      },
    ]

    // M-16: Cross-Origin isolation headers for dashboard pages (Spectre mitigation)
    const crossOriginIsolation = [
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    ]

    return [
      { source: "/:path*", headers: security },
      { source: "/dashboard/:path*", headers: crossOriginIsolation },
      { source: "/ops/:path*", headers: crossOriginIsolation },
      { source: "/system-monitor/:path*", headers: crossOriginIsolation },
      // Stricter Referrer-Policy for auth pages so tokens never leak via Referer
      { source: "/auth/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ]
  },

  async redirects() {
    return [
      {
        source: "/dashboard/system",
        destination: "/system-monitor",
        permanent: false,
      },
      {
        source: "/dashboard/system/:path*",
        destination: "/system-monitor/:path*",
        permanent: false,
      },
    ]
  },
}

// ---------------------------------------------------------------------------
// Bundle analyzer (opt-in).
//
// Run `ANALYZE=true pnpm build` to produce client / server / edge bundle
// reports. The wrapper is loaded lazily so the package is only required when
// the flag is set; if `@next/bundle-analyzer` isn't installed we fall back to
// the plain config silently. To enable for real, install the dev dep:
//
//   pnpm add -D @next/bundle-analyzer
// ---------------------------------------------------------------------------
async function withOptionalAnalyzer(config) {
  if (process.env.ANALYZE !== "true") return config
  try {
    const mod = await import("@next/bundle-analyzer")
    const withBundleAnalyzer = mod.default({ enabled: true })
    return withBundleAnalyzer(config)
  } catch {
    // Package not installed — keep going without analysis.
    return config
  }
}

export default await withOptionalAnalyzer(nextConfig)
