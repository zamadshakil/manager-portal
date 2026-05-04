"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/client"
import { Lock, Eye, EyeOff } from "lucide-react"

export default function UpdatePasswordForm() {
  const router = useRouter()
  
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Wait for Supabase session to initialize after redirect
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        setError("Your reset link is invalid or has expired.")
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
      
      router.push("/dashboard")
      router.refresh()
    } catch {
      setError("Failed to update password. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="border-white/20 dark:border-white/10 shadow-2xl bg-white/70 dark:bg-black/60 backdrop-blur-xl rounded-3xl overflow-hidden p-2 sm:p-4">
      <CardHeader className="space-y-2 text-center pb-6">
        <div className="mx-auto w-12 h-12 bg-white dark:bg-zinc-900 rounded-xl shadow-sm flex items-center justify-center mb-2 border border-zinc-200 dark:border-zinc-800">
          <Lock className="w-6 h-6 text-zinc-800 dark:text-zinc-200" />
        </div>
        <CardTitle className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">Update password</CardTitle>
        <CardDescription className="text-zinc-500 dark:text-zinc-400">
          Please enter your new password below.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="relative group">
            <Lock className="absolute left-3 top-3 h-5 w-5 text-zinc-400 group-focus-within:text-zinc-600 dark:group-focus-within:text-zinc-300 transition-colors" />
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              placeholder="New password"
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

          <div className="relative group">
            <Lock className="absolute left-3 top-3 h-5 w-5 text-zinc-400 group-focus-within:text-zinc-600 dark:group-focus-within:text-zinc-300 transition-colors" />
            <Input
              id="confirmPassword"
              type={showPassword ? "text" : "password"}
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading}
              placeholder="Confirm new password"
              className="pl-10 pr-10 bg-zinc-100/50 dark:bg-zinc-900/50 border-transparent focus:border-zinc-300 dark:focus:border-zinc-700 h-11 rounded-xl transition-all"
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
            {loading ? "Updating..." : "Update password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
