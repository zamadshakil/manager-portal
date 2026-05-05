"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { ArrowLeft, CheckCircle2, Eye, EyeOff } from "lucide-react"

export default function UpdatePasswordForm() {
  const router = useRouter()
  
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [sessionValid, setSessionValid] = useState<boolean | null>(null)

  // Wait for Supabase session to initialize after redirect
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        setSessionValid(false)
        setError("Your reset link is invalid or has expired.")
      } else {
        setSessionValid(true)
      }
    })
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    
    if (password !== confirmPassword) {
      setError("Passwords do not match.")
      return
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.")
      return
    }

    setError(null)
    setLoading(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.updateUser({
        password: password
      })
      
      if (error) {
        setError(error.message)
        return
      }
      
      setSuccess(true)
      // Redirect to dashboard after a brief success message
      setTimeout(() => {
        router.push("/dashboard")
        router.refresh()
      }, 2000)
    } catch {
      setError("Failed to update password. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  // Success state
  if (success) {
    return (
      <div className="space-y-8 animate-in fade-in slide-in-from-left-4 duration-500 text-center">
        <div className="flex flex-col items-center justify-center gap-4 py-8">
          <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mb-2 shadow-[0_0_20px_rgba(16,185,129,0.3)]">
            <CheckCircle2 className="w-8 h-8 text-emerald-500" />
          </div>
          <h3 className="text-2xl font-bold tracking-tight text-white">Password Updated</h3>
          <p className="text-slate-400 text-sm max-w-[280px]">
            Your password has been successfully updated. Redirecting to dashboard...
          </p>
        </div>
      </div>
    )
  }

  // Invalid session state
  if (sessionValid === false) {
    return (
      <div className="space-y-8 animate-in fade-in slide-in-from-left-4 duration-500 text-center">
        <div className="flex flex-col items-center justify-center gap-4 py-8">
          <div className="w-16 h-16 bg-rose-500/20 rounded-full flex items-center justify-center mb-2">
            <svg className="w-8 h-8 text-rose-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <h3 className="text-2xl font-bold tracking-tight text-white">Link Expired</h3>
          <p className="text-slate-400 text-sm max-w-[280px]">
            Your password reset link is invalid or has expired. Please request a new one.
          </p>
        </div>
        
        <Link 
          href="/auth/forgot-password"
          className="text-sm font-medium text-emerald-500 hover:text-emerald-400 transition-colors flex items-center justify-center gap-2"
        >
          Request new reset link
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-left-4 duration-500">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight text-white">New Password</h1>
        <p className="text-sm text-slate-400 leading-relaxed">
          Enter your new password below. Make sure it&apos;s at least 6 characters.
        </p>
      </div>

      <div className="space-y-6">
        <form onSubmit={onSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-slate-400">New Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading || sessionValid === null}
                placeholder="••••••••"
                className="h-11 pr-10 bg-[#0a1118]/50 border-slate-800 text-white placeholder:text-slate-600 focus:border-emerald-500/50 focus:ring-emerald-500/20 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-3 text-slate-500 hover:text-emerald-400 transition-colors focus:outline-none"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword" className="text-xs font-semibold uppercase tracking-wider text-slate-400">Confirm Password</Label>
            <Input
              id="confirmPassword"
              type={showPassword ? "text" : "password"}
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading || sessionValid === null}
              placeholder="••••••••"
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
            disabled={loading || sessionValid === null} 
            className="w-full h-11 bg-emerald-500 hover:bg-emerald-400 text-[#0d161f] font-bold text-sm shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all active:scale-[0.98] mt-2"
          >
            {loading ? (
              <div className="flex items-center justify-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#0d161f] border-t-transparent" />
                <span>UPDATING...</span>
              </div>
            ) : "UPDATE PASSWORD"}
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
