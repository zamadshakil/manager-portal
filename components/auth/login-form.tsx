"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/client"
import { Mail, Lock, Eye, EyeOff } from "lucide-react"

export default function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get("next") || "/dashboard"

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
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
        return
      }
      router.replace(next)
      router.refresh()
    } catch {
      setError("Sign-in failed. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="border-white/20 dark:border-white/10 shadow-2xl bg-white/70 dark:bg-black/60 backdrop-blur-xl rounded-3xl overflow-hidden p-2 sm:p-4">
      <CardHeader className="space-y-2 text-center pb-6">
        <div className="mx-auto w-12 h-12 bg-white dark:bg-zinc-900 rounded-xl shadow-sm flex items-center justify-center mb-2 border border-zinc-200 dark:border-zinc-800">
          <svg
            className="w-6 h-6 text-zinc-800 dark:text-zinc-200"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
          </svg>
        </div>
        <CardTitle className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">Sign in with email</CardTitle>
        <CardDescription className="text-zinc-500 dark:text-zinc-400">
          Make a new doc to bring your words, data, and teams together. For free
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
              placeholder="Email"
              className="pl-10 bg-zinc-100/50 dark:bg-zinc-900/50 border-transparent focus:border-zinc-300 dark:focus:border-zinc-700 h-11 rounded-xl transition-all"
            />
          </div>
          <div className="relative group">
            <Lock className="absolute left-3 top-3 h-5 w-5 text-zinc-400 group-focus-within:text-zinc-600 dark:group-focus-within:text-zinc-300 transition-colors" />
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              placeholder="Password"
              className="pl-10 pr-10 bg-zinc-100/50 dark:bg-zinc-900/50 border-transparent focus:border-zinc-300 dark:focus:border-zinc-700 h-11 rounded-xl transition-all"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-3 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors focus:outline-none"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
          
          <div className="flex justify-end mt-[-8px]">
            <Link 
              href="/auth/forgot-password" 
              className="text-[13px] font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
            >
              Forgot password?
            </Link>
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
            {loading ? "Signing in..." : "Get Started"}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex flex-col space-y-4 pt-2 pb-4">
        <div className="relative w-full flex items-center justify-center mt-2">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-zinc-200/60 dark:border-zinc-800/60 border-dashed"></div>
          </div>
          <div className="relative flex justify-center text-[11px] uppercase">
            <span className="bg-[#f0f4f8] dark:bg-[#1a1c20] px-3 py-1 text-zinc-400 rounded-full mix-blend-multiply dark:mix-blend-normal">Or sign in with</span>
          </div>
        </div>
        
        <div className="grid grid-cols-3 gap-3 w-full">
          <Button type="button" variant="outline" className="h-11 rounded-xl bg-white/60 dark:bg-zinc-900/60 hover:bg-white dark:hover:bg-zinc-800 border-white/20 shadow-sm flex items-center justify-center transition-all" onClick={() => alert('Social login not configured.')}>
            <svg viewBox="0 0 24 24" className="w-5 h-5"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/><path d="M1 1h22v22H1z" fill="none"/></svg>
          </Button>
          <Button type="button" variant="outline" className="h-11 rounded-xl bg-white/60 dark:bg-zinc-900/60 hover:bg-white dark:hover:bg-zinc-800 border-white/20 shadow-sm flex items-center justify-center transition-all" onClick={() => alert('Social login not configured.')}>
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.469h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.469h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
          </Button>
          <Button type="button" variant="outline" className="h-11 rounded-xl bg-white/60 dark:bg-zinc-900/60 hover:bg-white dark:hover:bg-zinc-800 border-white/20 shadow-sm flex items-center justify-center transition-all" onClick={() => alert('Social login not configured.')}>
            <svg viewBox="0 0 24 24" className="w-5 h-5 text-black dark:text-white" fill="currentColor"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.126 3.822 3.072 1.53-.055 2.114-.98 3.974-.98 1.845 0 2.38.98 3.992.95 1.664-.025 2.67-1.503 3.659-2.951 1.144-1.677 1.616-3.299 1.64-3.385-.035-.014-3.17-1.218-3.197-4.85-.025-3.04 2.483-4.528 2.597-4.597-1.425-2.09-3.633-2.368-4.42-2.42-1.895-.123-3.716 1.107-4.665 1.107zM15.545 4.195c.833-1.008 1.39-2.413 1.238-3.822-1.203.048-2.678.8-3.535 1.815-.765.894-1.42 2.338-1.235 3.722 1.341.104 2.697-.704 3.532-1.715z"/></svg>
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}
