import { Suspense } from "react"
import Image from "next/image"
import LoginForm from "@/components/auth/login-form"

export const dynamic = "force-dynamic"

export default function LoginPage() {
  return (
    <main className="relative min-h-svh flex items-center justify-center p-4 overflow-hidden bg-[#030712]">
      {/* Background Hero Image */}
      <div className="absolute inset-0 z-0">
        <Image
          src="/professional_dark_bg.png"
          alt="Hierarchia Portal"
          fill
          priority
          className="object-cover opacity-60 mix-blend-screen"
        />
        {/* Overlay gradients for better readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#030712]/80 via-[#030712]/40 to-[#030712]/90" />
      </div>

      {/* Centered Glassmorphism Card */}
      <div className="relative z-10 w-full max-w-[440px] animate-in fade-in zoom-in-95 duration-700">
        
        {/* Glassmorphism Container */}
        <div className="backdrop-blur-2xl bg-[#111827]/95 border border-white/10 rounded-2xl shadow-[0_20px_40px_-10px_rgba(0,0,0,0.7)] overflow-hidden">
          
          {/* Header */}
          <div className="p-8 pb-4 flex flex-col items-center">
            <div className="flex flex-col items-center gap-4 mb-2">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-500/20 to-[#111827] flex items-center justify-center shadow-[0_0_20px_rgba(59,130,246,0.3)] border border-blue-500/30 backdrop-blur-md">
                <div className="h-5 w-5 rounded-full bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,1)] animate-pulse" />
              </div>
              <span className="text-2xl font-bold tracking-tight text-white">Hierarchia</span>
            </div>
          </div>

          {/* Form Area */}
          <div className="px-8 pb-8">
            <Suspense fallback={null}>
              <LoginForm
                showGuestAccess={process.env.SHOWCASE_GUEST_LOGIN_ENABLED === "true"}
              />
            </Suspense>
          </div>
          
          {/* Footer */}
          <div className="px-8 py-5 bg-black/40 border-t border-white/5 flex justify-center">
            <p className="text-xs text-white/50">
              Need access? Contact your workspace administrator.
            </p>
          </div>

        </div>
      </div>
    </main>
  )
}
