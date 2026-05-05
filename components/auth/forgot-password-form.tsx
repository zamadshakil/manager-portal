"use client"

import { useState } from "react"
import Link from "next/link"
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { requestPasswordReset } from "@/app/actions/auth"

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
      const res = await requestPasswordReset(email)

      if (!res.success) {
        setError(res.error || "Failed to send reset link. Please try again.")
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
      <div className="space-y-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 shadow-[0_0_20px_rgba(16,185,129,0.2)]">
          <CheckCircle2 className="h-7 w-7 text-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)] rounded-full" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-white font-['Space_Grotesk']">
            Check your inbox
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            We sent a password reset link to{" "}
            <span className="font-medium text-white">{email}</span>.
            The link will expire in 1 hour.
          </p>
        </div>
        <div className="pt-2">
          <Link
            href="/auth/login"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-400 hover:text-emerald-300 hover:underline underline-offset-4 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white font-['Space_Grotesk']">
          Reset your password
        </h1>
        <p className="text-sm text-slate-400 leading-relaxed text-pretty">
          Enter the email associated with your account and we&apos;ll send
          you a secure link to set a new password.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <div className="space-y-2">
          <Label htmlFor="email" className="text-sm font-medium text-slate-300">
            Email
          </Label>
          <div className="relative">
            <Mail
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
              aria-hidden="true"
            />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              placeholder="you@company.com"
              className="h-11 pl-10 bg-black/20 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-emerald-500/20 focus-visible:border-emerald-500/50 transition-all"
            />
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
          disabled={loading}
          className="w-full h-11 text-sm font-semibold bg-emerald-500 hover:bg-emerald-600 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)] hover:shadow-[0_0_25px_rgba(16,185,129,0.6)] border-none transition-all duration-300"
        >
          {loading ? (
            <span className="inline-flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Sending link&hellip;
            </span>
          ) : (
            "Send reset link"
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
