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
    <>
      {loading && <FullPageLoader text="Signing in..." />}
      <Card className={cn("border-border/80 shadow-sm transition-all duration-300", loading && "opacity-50 blur-sm pointer-events-none scale-[0.98]")}>
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl tracking-tight">Sign in</CardTitle>
          <CardDescription className="text-muted-foreground">
            Hierarchia portal. Accounts are provisioned by your administrator.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                placeholder="admin@hierarchia.app"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  )
}

