import type { Metadata } from "next"
import { Inter, JetBrains_Mono } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { WebVitalsReporter } from "@/components/web-vitals-reporter"
import "./globals.css"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  // `swap` shows fallback text immediately and hot-swaps the webfont when
  // ready; `adjustFontFallback` matches metrics so the swap doesn't shift.
  display: "swap",
  adjustFontFallback: "Arial",
  preload: true,
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
  // Mono is only used for IDs / code blocks — don't preload, don't block.
  preload: false,
})

export const metadata: Metadata = {
  title: "Hierarchia — AI-Driven Hierarchy Portal",
  description:
    "A unified portal for managers and teams: announcements, AI-validated submissions, materials, analytics, and automated reporting.",
  generator: "v0.app",
}

// Pull the Supabase URL out of the public env at module evaluation time so
// the `<link rel="preconnect">` below resolves to the project's actual host
// instead of a literal placeholder. If the env var isn't defined (local
// preview, CI), we silently skip the hint rather than emit a broken link.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} bg-background`}>
      <head>
        {/*
          Resource hints. Each costs a single TLS handshake during browser
          idle time, but unblocks every subsequent request to the same host
          on its very first byte:
            - Supabase auth + REST is on the project's own subdomain.
            - Document blobs and avatars are on `*.public.blob.vercel-storage.com`.
            - Vercel Analytics + Web Vitals beacons are on `vitals.vercel-insights.com`.
          We use `preconnect` (full TLS) for the hot path, `dns-prefetch`
          for the cooler ones to keep the connection budget reasonable.
        */}
        {SUPABASE_URL ? (
          <link rel="preconnect" href={SUPABASE_URL} crossOrigin="anonymous" />
        ) : null}
        <link
          rel="dns-prefetch"
          href="https://public.blob.vercel-storage.com"
        />
        <link rel="dns-prefetch" href="https://vitals.vercel-insights.com" />
      </head>
      <body className="font-sans antialiased">
        {children}
        {/* Per-route Core Web Vitals — beacons to /api/vitals in prod. */}
        <WebVitalsReporter />
        {process.env.NODE_ENV === "production" && <Analytics />}
      </body>
    </html>
  )
}
