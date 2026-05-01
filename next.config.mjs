/** @type {import('next').NextConfig} */
const nextConfig = {
  // Server Actions in Next.js cap request bodies at 1 MB by default. Our UI
  // advertises 25 MB document uploads, so we raise the limit. Long-term we
  // intend to move to a Vercel Blob client-token flow that streams browser→
  // Blob without traversing the server, but until then this prevents 413s.
  experimental: {
    serverActions: { bodySizeLimit: "30mb" },
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
  serverExternalPackages: ["unpdf", "mammoth", "officeparser", "tesseract.js"],

  async headers() {
    const security = [
      {
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      },
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' blob: data: https://*.vercel-storage.com",
          "font-src 'self' https://fonts.gstatic.com",
          "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.vercel-storage.com https://va.vercel-scripts.com",
          "frame-ancestors 'none'",
        ].join("; "),
      },
    ]
    return [{ source: "/:path*", headers: security }]
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
