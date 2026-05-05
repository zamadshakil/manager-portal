import { Suspense } from "react"
import ForgotPasswordForm from "@/components/auth/forgot-password-form"

export const dynamic = "force-dynamic"

export default function ForgotPasswordPage() {
  return (
    <main className="min-h-svh bg-[#0a1118] flex flex-col md:flex-row overflow-hidden">
      {/* Left Sidebar - Forgot Password Form */}
      <div className="w-full md:w-[450px] lg:w-[500px] flex flex-col justify-between p-8 lg:p-12 bg-[#0d161f] border-r border-white/5 z-10">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <div className="h-4 w-4 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
            </div>
            <span className="text-xl font-bold tracking-tight text-white">Hierarchia</span>
          </div>
          <div className="flex items-center gap-1 text-xs font-medium text-slate-400 cursor-pointer hover:text-white transition-colors">
             <span className="uppercase">English</span>
             <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
          </div>
        </header>

        <div className="flex-1 flex items-center justify-center py-12">
          <div className="w-full max-w-sm">
            <Suspense fallback={null}>
              <ForgotPasswordForm />
            </Suspense>
          </div>
        </div>

        <footer className="text-xs text-slate-500">
          © {new Date().getFullYear()} Hierarchia AI. All rights reserved.
        </footer>
      </div>

      {/* Right Side - Hero Image */}
      <div className="hidden md:block relative flex-1 bg-[#0a1118]">
        <img 
          src="/digital_globe_hero_1777914645138.png" 
          alt="Hierarchia World" 
          className="absolute inset-0 w-full h-full object-cover opacity-80"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0d161f] via-transparent to-transparent" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.05)_0%,transparent_70%)]" />
      </div>
    </main>
  )
}
