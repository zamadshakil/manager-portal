"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"

export default function UpdatePasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()

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
      if (session) {
        setSessionValid(true)
        return
      }

      const token_hash = searchParams.get("token_hash")
      const type = searchParams.get("type")

      if (token_hash && type === "recovery") {
        supabase.auth.verifyOtp({ token_hash, type: "recovery" }).then(({ data, error }) => {
          if (error || !data.session) {
            setSessionValid(false)
            setError(error?.message || "Your reset link is invalid or has expired.")
          } else {
            // Remove the token from the URL so it doesn't cause issues on refresh
            router.replace("/auth/update-password")
            setSessionValid(true)
          }
        })
      } else {
        setSessionValid(false)
        setError("Your reset link is invalid or has expired.")
      }
    })
  }, [searchParams, router])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (password !== confirmPassword) {
      setError("Passwords do not match.")
      return
    }

    // M-5: Enforce a minimum-strength policy before talking to GoTrue.
    // Server-side GoTrue should also be configured with
    //   GOTRUE_PASSWORD_MIN_LENGTH=12 and GOTRUE_PASSWORD_HIBP=true
    // so the same rules are enforced regardless of the client used.
    if (password.length < 12) {
      setError("Password must be at least 12 characters.")
      return
    }
    const hasLower = /[a-z]/.test(password)
    const hasUpper = /[A-Z]/.test(password)
    const hasDigit = /\d/.test(password)
    const hasSymbol = /[^A-Za-z0-9]/.test(password)
    const variety = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length
    if (variety < 3) {
      setError(
        "Password must include at least three of: lowercase, uppercase, digit, symbol.",
      )
      return
    }

    setError(null)
    setLoading(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.updateUser({
        password: password,
      })

      if (error) {
        // H-9: Avoid leaking GoTrue internal error text — keep it generic.
        console.error("[update-password] Supabase error:", error.message)
        setError("Could not update your password. Please try again.")
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
      <div className="space-y-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-500/10 shadow-[0_0_20px_rgba(59,130,246,0.2)]">
          <CheckCircle2 className="h-7 w-7 text-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.5)] rounded-full" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Password updated
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            You&apos;re all set. Redirecting to your dashboard&hellip;
          </p>
        </div>
      </div>
    )
  }

  // Invalid session state
  if (sessionValid === false) {
    return (
      <div className="space-y-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
          <XCircle className="h-7 w-7 text-destructive" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            This link has expired
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            Your password reset link is invalid or has expired. Request a
            fresh one and try again.
          </p>
        </div>
        <div className="pt-2">
          <Link
            href="/auth/forgot-password"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-400 hover:text-blue-300 hover:underline underline-offset-4 transition-colors"
          >
            Request new reset link
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">
          Choose a new password
        </h1>
        <p className="text-sm text-slate-400 leading-relaxed text-pretty">
          Pick something memorable but hard to guess. Use at least 6
          characters.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <div className="space-y-2">
          <Label htmlFor="password" className="text-sm font-medium text-slate-300">
            New password
          </Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading || sessionValid === null}
              placeholder="Enter your new password"
              className="h-11 pr-10 bg-black/50 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-blue-500/20 focus-visible:border-blue-500/50 transition-all"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              tabIndex={-1}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors focus:outline-none"
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword" className="text-sm font-medium text-slate-300">
            Confirm password
          </Label>
          <div className="relative">
            <Input
              id="confirmPassword"
              type={showPassword ? "text" : "password"}
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading || sessionValid === null}
              placeholder="Re-enter your new password"
              className="h-11 pr-10 bg-black/50 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-blue-500/20 focus-visible:border-blue-500/50 transition-all"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              tabIndex={-1}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors focus:outline-none"
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
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
          disabled={loading || sessionValid === null}
          className="w-full h-11 text-sm font-semibold bg-blue-500 hover:bg-blue-600 text-white shadow-[0_0_15px_rgba(59,130,246,0.4)] hover:shadow-[0_0_25px_rgba(59,130,246,0.6)] border-none transition-all duration-300"
        >
          {loading ? (
            <span className="inline-flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Updating&hellip;
            </span>
          ) : (
            "Update password"
          )}
        </Button>
      </form>

      <div className="flex justify-center">
        <Link
          href="/auth/login"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to sign in
        </Link>
      </div>
    </div>
  )
}
