"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { ArrowLeft, CheckCircle2 } from "lucide-react"

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    
    if (!email || !email.includes("@")) {
      setError("Please enter a valid email address.")
      return
    }

    setError(null)
    setLoading(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/update-password`,
      })
      
      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }
      
      setSuccess(true)
    } catch {
      setError("Failed to send reset link. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="space-y-8 animate-in fade-in slide-in-from-left-4 duration-500 text-center">
        <div className="flex flex-col items-center justify-center gap-4 py-8">
          <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mb-2 shadow-[0_0_20px_rgba(16,185,129,0.3)]">
            <CheckCircle2 className="w-8 h-8 text-emerald-500" />
          </div>
          <h3 className="text-2xl font-bold tracking-tight text-white">Check your email</h3>
          <p className="text-slate-400 text-sm max-w-[280px]">
            We've sent a password reset link to <strong className="text-emerald-400">{email}</strong>.
          </p>
        </div>
        
        <Link 
          href="/auth/login"
          className="text-sm font-medium text-slate-400 hover:text-emerald-400 transition-colors flex items-center justify-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" /> Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-left-4 duration-500">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight text-white">Reset Password</h1>
        <p className="text-sm text-slate-400 leading-relaxed">
          Enter your email address and we'll send you a link to reset your password.
        </p>
      </div>

      <div className="space-y-6">
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
            className="w-full h-11 bg-emerald-500 hover:bg-emerald-400 text-[#0d161f] font-bold text-sm shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all active:scale-[0.98] mt-2"
          >
            {loading ? (
              <div className="flex items-center justify-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#0d161f] border-t-transparent" />
                <span>SENDING LINK...</span>
              </div>
            ) : "SEND RESET LINK"}
          </Button>
        </form>
        
        <div className="flex justify-center mt-6">
          <Link 
            href="/auth/login" 
            className="text-xs font-medium text-slate-400 hover:text-emerald-400 transition-colors flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" /> Back to login
          </Link>
        </div>
      </div>
    </div>
  )
}
