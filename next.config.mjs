/** @type {import('next').NextConfig} */
const nextConfig = {
  // Server Actions in Next.js cap request bodies at 1 MB by default. Our UI
  // advertises 25 MB document uploads, so we raise the limit. Long-term we
  // intend to move to a Vercel Blob client-token flow that streams browser→
  // Blob without traversing the server, but until then this prevents 413s.
  experimental: {
    serverActions: { bodySizeLimit: "30mb" },
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

export default nextConfig
