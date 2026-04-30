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
    // import to the specific module path. We also include the Radix and
    // common chart packages we touch the most.
    // ------------------------------------------------------------------
    optimizePackageImports: [
      "lucide-react",
      "date-fns",
      "recharts",
      "@radix-ui/react-tabs",
      "@radix-ui/react-dialog",
      "@radix-ui/react-alert-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-popover",
      "@radix-ui/react-select",
    ],
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
    ]
    return [{ source: "/:path*", headers: security }]
  },
}

// ---------------------------------------------------------------------------
// Optional bundle analyzer.
//
// Run `ANALYZE=true pnpm build` to emit `.next/analyze/*.html` reports for
// the client and server bundles. The analyzer is a dev dependency that we
// import lazily and defensively — if `@next/bundle-analyzer` isn't
// installed (e.g. on Vercel preview deployments), the build still succeeds
// and just skips the analysis step.
// ---------------------------------------------------------------------------
let exported = nextConfig
if (process.env.ANALYZE === "true") {
  try {
    const { default: withBundleAnalyzer } = await import("@next/bundle-analyzer")
    exported = withBundleAnalyzer({ enabled: true, openAnalyzer: false })(nextConfig)
  } catch {
    // eslint-disable-next-line no-console
    console.warn(
      "[next.config] ANALYZE=true was set but `@next/bundle-analyzer` is not installed. " +
        "Run `pnpm add -D @next/bundle-analyzer` to enable bundle reports.",
    )
  }
}

export default exported
