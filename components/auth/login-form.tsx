"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { createClient } from "@/lib/supabase/client"

export default function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get("next") || "/dashboard"

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [remember, setRemember] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Basic email validation to prevent 500 schema error from Supabase
    if (!email || !email.includes("@")) {
      setError("Please enter a valid email address.")
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
        setLoading(false)
        return
      }
      router.replace(next)
      router.refresh()
      // Keep the loading state while we navigate to /dashboard so the
      // button stays in its loading state instead of flashing back.
    } catch {
      setError("Sign-in failed. Please try again.")
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white font-['Space_Grotesk']">
          Sign in to your portal
        </h1>
        <p className="text-sm text-slate-400 leading-relaxed text-pretty">
          Welcome back. Enter your credentials to access announcements,
          submissions, and team analytics.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <div className="space-y-2">
          <Label htmlFor="email" className="text-sm font-medium text-slate-300">
            Email
          </Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            placeholder="you@company.com"
            className="h-11 bg-black/20 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-emerald-500/20 focus-visible:border-emerald-500/50 transition-all"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-sm font-medium text-slate-300">
              Password
            </Label>
            <Link
              href="/auth/forgot-password"
              className="text-xs font-medium text-emerald-400 hover:text-emerald-300 hover:underline underline-offset-4 transition-colors"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              placeholder="Enter your password"
              className="h-11 pr-10 bg-black/20 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-emerald-500/20 focus-visible:border-emerald-500/50 transition-all"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              tabIndex={-1}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors focus:outline-none focus-visible:text-slate-200"
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="remember"
            checked={remember}
            onCheckedChange={(v) => setRemember(v === true)}
            disabled={loading}
            className="border-white/20 data-[state=checked]:bg-emerald-500 data-[state=checked]:text-white data-[state=checked]:border-emerald-500"
          />
          <Label
            htmlFor="remember"
            className="text-sm font-normal text-slate-400 cursor-pointer hover:text-slate-300 transition-colors"
          >
            Keep me signed in on this device
          </Label>
        </div>

        {error ? (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            <p className="text-sm text-destructive leading-snug">{error}</p>
          </div>
        ) : null}

        <Button
          type="submit"
          disabled={loading}
          className="w-full h-11 text-sm font-semibold bg-emerald-500 hover:bg-emerald-600 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)] hover:shadow-[0_0_25px_rgba(16,185,129,0.6)] border-none transition-all duration-300"
        >
          {loading ? (
            <span className="inline-flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Signing in&hellip;
            </span>
          ) : (
            "Sign in"
          )}
        </Button>
      </form>

      <p className="text-center text-sm text-slate-500">
        Need an account?{" "}
        <span className="font-medium text-slate-300 hover:text-white transition-colors cursor-help">
          Ask your administrator
        </span>{" "}
        to invite you.
      </p>
    </div>
  )
}
