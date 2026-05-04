"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"


import { FullPageLoader } from "@/components/ui/loader"

export default function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get("next") || "/dashboard"

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    
    // Basic email validation to prevent 500 schema error from Supabase
    if (!email || !email.includes("@")) {
      setError("Please enter a valid email address (e.g., admin@hierarchia.app)")
      return
    }

    setError(null)
    setLoading(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        // Avoid disclosing whether the email exists or password is wrong.
        setError("Email or password is incorrect.")
        setLoading(false) // Important to set loading to false if there is an error
        return
      }
      router.replace(next)
      router.refresh()
      // We don't set loading to false here because we want to keep the animation until the dashboard is ready
    } catch {
      setError("Sign-in failed. Please try again.")
      setLoading(false)
    }
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-left-4 duration-500">
      {loading && <FullPageLoader text="Authenticating..." />}
      
      <div className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight text-white">Login</h1>
        <p className="text-sm text-slate-400 leading-relaxed">
          Step into the world of AI-driven hierarchy and intelligent management systems.
        </p>
      </div>

      <div className="space-y-6">
        {/* Metamask Button */}
        <Button 
          type="button" 
          variant="outline" 
          className="w-full h-11 bg-transparent border-slate-700 hover:bg-slate-800 text-slate-300 gap-3 group transition-all"
        >
          <div className="h-5 w-5 flex items-center justify-center bg-orange-500/10 rounded-sm group-hover:bg-orange-500/20 transition-colors">
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-orange-500" fill="currentColor">
              <path d="M22 12l-4-4v3H6v2h12v3l4-4z" />
            </svg>
          </div>
          <span className="text-xs font-semibold uppercase tracking-wider">Sign in with Metamask</span>
        </Button>

        {/* Divider */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-slate-800" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-[#0d161f] px-4 text-slate-500 font-medium tracking-widest">or sign in with email</span>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-wider text-slate-400">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              placeholder="mail@example.com"
              className="h-11 bg-[#0a1118]/50 border-slate-800 text-white placeholder:text-slate-600 focus:border-emerald-500/50 focus:ring-emerald-500/20 transition-all"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-slate-400">Password</Label>
            </div>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              className="h-11 bg-[#0a1118]/50 border-slate-800 text-white placeholder:text-slate-600 focus:border-emerald-500/50 focus:ring-emerald-500/20 transition-all"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <input 
                type="checkbox" 
                id="remember" 
                className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-emerald-600 focus:ring-emerald-500/20"
              />
              <Label htmlFor="remember" className="text-xs font-medium text-slate-400 cursor-pointer">Remember me?</Label>
            </div>
            <button type="button" className="text-xs font-medium text-emerald-500 hover:text-emerald-400 transition-colors">
              Forgot password?
            </button>
          </div>

          {error ? (
            <div className="p-3 rounded-md bg-rose-500/10 border border-rose-500/20">
              <p role="alert" className="text-xs font-medium text-rose-500">
                {error}
              </p>
            </div>
          ) : null}

          <Button 
            type="submit" 
            disabled={loading} 
            className="w-full h-11 bg-emerald-500 hover:bg-emerald-400 text-[#0d161f] font-bold text-sm shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all active:scale-[0.98]"
          >
            {loading ? "AUTHENTICATING..." : "LOGIN"}
          </Button>

          <div className="text-center">
            <p className="text-xs text-slate-500">
              Not registered yet?{" "}
              <button type="button" className="text-emerald-500 hover:underline font-medium">
                Create an account
              </button>
            </p>
          </div>
        </form>
      </div>
    </div>
  )
}


