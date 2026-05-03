import type { Metadata } from "next"
import { Inter, JetBrains_Mono } from "next/font/google"
import { WebVitalsReporter } from "@/components/web-vitals-reporter"
import "./globals.css"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
})

export const metadata: Metadata = {
  title: "Hierarchia — AI-Driven Hierarchy Portal",
  description:
    "A unified portal for managers and teams: announcements, AI-validated submissions, materials, analytics, and automated reporting.",
  generator: "v0.app",
}

// Best-effort derivation of the Supabase origin from the public URL so we can
// preconnect during HTML streaming. This shaves 100-300ms off the first
// auth/data round-trip on a cold load. Falls back gracefully if the env var
// is missing (e.g. during local builds without secrets).
function getSupabaseOrigin(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const supabaseOrigin = getSupabaseOrigin()

  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} bg-background`}>
      <head>
        {/*
          Resource hints. React 19 auto-hoists <link> tags to <head>, but
          declaring them inside an explicit <head> guarantees ordering above
          the body so the browser can act on them before parsing the rest of
          the document. Preconnecting to the Supabase/Kong gateway shaves
          100-300ms off the first auth round-trip on a cold load.
        */}
        {supabaseOrigin ? (
          <>
            <link rel="preconnect" href={supabaseOrigin} crossOrigin="anonymous" />
            <link rel="dns-prefetch" href={supabaseOrigin} />
          </>
        ) : null}

      </head>
      <body className="font-sans antialiased">
        {children}
        <WebVitalsReporter />
      </body>
    </html>
  )
}
