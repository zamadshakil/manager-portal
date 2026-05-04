"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/client"
import { Mail, ArrowLeft, CheckCircle2 } from "lucide-react"

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
      <Card className="border-white/20 dark:border-white/10 shadow-2xl bg-white/70 dark:bg-black/60 backdrop-blur-xl rounded-3xl overflow-hidden p-2 sm:p-4 text-center">
        <CardContent className="pt-8 pb-4 flex flex-col items-center gap-4">
          <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-2">
            <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
          </div>
          <h3 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">Check your email</h3>
          <p className="text-zinc-500 dark:text-zinc-400 text-sm max-w-[280px]">
            We've sent a password reset link to <strong>{email}</strong>.
          </p>
        </CardContent>
        <CardFooter className="flex justify-center pb-6">
          <Link 
            href="/auth/login"
            className="text-sm font-medium text-zinc-900 dark:text-white hover:underline flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" /> Back to sign in
          </Link>
        </CardFooter>
      </Card>
    )
  }

  return (
    <Card className="border-white/20 dark:border-white/10 shadow-2xl bg-white/70 dark:bg-black/60 backdrop-blur-xl rounded-3xl overflow-hidden p-2 sm:p-4">
      <CardHeader className="space-y-2 text-center pb-6">
        <div className="mx-auto w-12 h-12 bg-white dark:bg-zinc-900 rounded-xl shadow-sm flex items-center justify-center mb-2 border border-zinc-200 dark:border-zinc-800">
          <Lock className="w-6 h-6 text-zinc-800 dark:text-zinc-200" />
        </div>
        <CardTitle className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">Reset password</CardTitle>
        <CardDescription className="text-zinc-500 dark:text-zinc-400">
          Enter your email address and we'll send you a link to reset your password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="relative group">
            <Mail className="absolute left-3 top-3 h-5 w-5 text-zinc-400 group-focus-within:text-zinc-600 dark:group-focus-within:text-zinc-300 transition-colors" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              placeholder="Email address"
              className="pl-10 bg-zinc-100/50 dark:bg-zinc-900/50 border-transparent focus:border-zinc-300 dark:focus:border-zinc-700 h-11 rounded-xl transition-all"
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive text-center font-medium bg-destructive/10 text-destructive py-2 rounded-lg">
              {error}
            </p>
          ) : null}
          <Button 
            type="submit" 
            disabled={loading} 
            className="w-full h-11 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 shadow-md transition-all font-medium text-base mt-2"
          >
            {loading ? "Sending link..." : "Send reset link"}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex justify-center pt-2 pb-4">
        <Link 
          href="/auth/login" 
          className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" /> Back to sign in
        </Link>
      </CardFooter>
    </Card>
  )
}
