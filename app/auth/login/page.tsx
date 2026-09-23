import { Suspense } from "react"
import Image from "next/image"
import Link from "next/link"
import LoginForm from "@/components/auth/login-form"

export const dynamic = "force-dynamic"

export default function LoginPage() {
  return (
    <main className="relative min-h-svh flex items-center justify-center p-4 sm:p-6 overflow-hidden bg-[#030712] text-slate-100 selection:bg-blue-500/30 selection:text-white">
      {/* Background Hero Image */}
      <div className="absolute inset-0 z-0">
        <Image
          src="/professional_dark_bg.png"
          alt="Hierarchia Portal"
          fill
          priority
          className="object-cover opacity-50 mix-blend-screen"
        />
        {/* Radial ambient glows */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] bg-gradient-to-tr from-blue-600/20 via-indigo-600/15 to-transparent rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-gradient-to-t from-blue-900/20 to-transparent rounded-full blur-2xl pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#030712]/75 via-[#030712]/45 to-[#030712]/90" />
      </div>

      {/* Centered Glassmorphism Card */}
      <div className="relative z-10 w-full max-w-[480px] animate-in fade-in zoom-in-95 duration-700">
        
        {/* Glassmorphism Container with top subtle border glow */}
        <div className="relative backdrop-blur-2xl bg-[#0c1220]/92 border border-white/10 rounded-2xl sm:rounded-3xl shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_0_1px_rgba(255,255,255,0.06)] overflow-hidden">
          {/* Top highlight shine line */}
          <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-blue-400/50 to-transparent" />

          {/* Header & Brand Emblem */}
          <div className="pt-8 px-6 sm:px-8 pb-3 flex flex-col items-center text-center">
            <div className="relative mb-3 flex items-center justify-center">
              {/* Outer soft glow */}
              <div className="absolute -inset-2 rounded-2xl bg-gradient-to-r from-blue-600/30 to-indigo-500/30 blur-lg opacity-75" />
              
              {/* Logo Emblem */}
              <div className="relative flex h-13 w-13 p-3 items-center justify-center rounded-2xl border border-blue-500/30 bg-gradient-to-b from-[#182338] to-[#0d1424] shadow-xl shadow-blue-500/20 ring-1 ring-white/10">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  className="h-6 w-6 text-blue-400 drop-shadow-[0_0_10px_rgba(96,165,250,0.8)]"
                  aria-hidden="true"
                >
                  <path
                    d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z"
                    fill="currentColor"
                  />
                </svg>
              </div>
            </div>

            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl font-bold tracking-tight text-white">Hierarchia</span>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase bg-blue-500/10 text-blue-300 border border-blue-500/25">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Showcase Portal
              </span>
            </div>
          </div>

          {/* Form Area */}
          <div className="px-6 sm:px-8 pb-7">
            <Suspense fallback={null}>
              <LoginForm
                showGuestAccess={process.env.SHOWCASE_GUEST_LOGIN_ENABLED === "true"}
              />
            </Suspense>
          </div>
          
          {/* Footer */}
          <div className="px-6 sm:px-8 py-3.5 bg-black/40 border-t border-white/5 flex items-center justify-between text-xs text-slate-400">
            <span>Need enterprise access?</span>
            <Link
              href="https://showcase.zamdevai.com"
              className="text-blue-400 hover:text-blue-300 transition-colors font-medium flex items-center gap-1"
            >
              Showcase site &rarr;
            </Link>
          </div>

        </div>
      </div>
    </main>
  )
}

