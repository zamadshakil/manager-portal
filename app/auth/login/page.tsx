import { Suspense } from "react"
import LoginForm from "@/components/auth/login-form"

export const dynamic = "force-dynamic"

export default function LoginPage() {
  return (
    <main className="relative min-h-svh flex items-center justify-center p-4 overflow-hidden bg-[#030712]">
      {/* Background Hero Image */}
      <div className="absolute inset-0 z-0">
        <img 
          src="/digital_globe_hero_1777914645138.png" 
          alt="Hierarchia World" 
          className="absolute inset-0 w-full h-full object-cover opacity-60 mix-blend-screen"
        />
        {/* Overlay gradients for better readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#030712]/80 via-[#030712]/40 to-[#030712]/90" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.1)_0%,transparent_70%)]" />
      </div>

      {/* Centered Glassmorphism Card */}
      <div className="relative z-10 w-full max-w-[440px] animate-in fade-in zoom-in-95 duration-700">
        {/* Top Glow Accent */}
        <div className="absolute -top-px left-10 right-10 h-px bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent shadow-[0_0_20px_rgba(16,185,129,0.8)]" />
        
        {/* Glassmorphism Container */}
        <div className="backdrop-blur-2xl bg-[#111827]/70 border border-white/10 rounded-2xl shadow-[0_20px_40px_-10px_rgba(0,0,0,0.7)] overflow-hidden">
          
          {/* Header */}
          <div className="p-8 pb-4 flex flex-col items-center">
            <div className="flex flex-col items-center gap-4 mb-2">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-500/20 to-[#111827] flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.3)] border border-emerald-500/30 backdrop-blur-md">
                <div className="h-5 w-5 rounded-full bg-emerald-400 shadow-[0_0_15px_rgba(16,185,129,1)] animate-pulse" />
              </div>
              <span className="text-2xl font-bold tracking-tight text-white font-['Space_Grotesk']">Hierarchia</span>
            </div>
          </div>

          {/* Form Area */}
          <div className="px-8 pb-8">
            <Suspense fallback={null}>
              <LoginForm />
            </Suspense>
          </div>
          
          {/* Footer */}
          <div className="px-8 py-5 bg-black/40 border-t border-white/5 flex justify-center">
            <span className="text-[10px] text-slate-500 font-semibold tracking-widest uppercase">
              © {new Date().getFullYear()} HIERARCHIA AI
            </span>
          </div>
        </div>
        
        {/* Subtle Bottom Glow Accent */}
        <div className="absolute -bottom-px left-20 right-20 h-px bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent" />
      </div>
      
      {/* Absolute Language Toggle */}
      <div className="absolute top-6 right-8 z-20 flex items-center gap-2 text-xs font-semibold tracking-widest text-slate-400 cursor-pointer hover:text-emerald-400 transition-colors">
         <span className="uppercase">English</span>
         <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
      </div>
    </main>
  )
}
