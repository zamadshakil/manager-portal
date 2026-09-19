"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import {
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
  ShieldCheck,
  Briefcase,
  UserCheck,
  Sparkles,
  ArrowRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { createClient } from "@/lib/supabase/client"

const DEMO_PERSONAS = [
  {
    role: "Super Admin",
    title: "Login as Super Admin",
    email: "admin@zamdevai.com",
    badge: "Full Access",
    badgeClass: "border-amber-500/40 bg-amber-500/15 text-amber-300",
    desc: "Global AI rules, analytics, team control & billing",
    icon: ShieldCheck,
    hoverClass: "hover:border-amber-500/50 hover:bg-amber-500/10",
  },
  {
    role: "Manager",
    title: "Login as Manager",
    email: "manager@zamdevai.com",
    badge: "Operations",
    badgeClass: "border-blue-500/40 bg-blue-500/15 text-blue-300",
    desc: "Team task dispatch, submission review & team chat",
    icon: Briefcase,
    hoverClass: "hover:border-blue-500/50 hover:bg-blue-500/10",
  },
  {
    role: "Team Member",
    title: "Login as Team Member",
    email: "member@zamdevai.com",
    badge: "Field Ops",
    badgeClass: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
    desc: "Assigned tasks, document uploads & instant AI scoring",
    icon: UserCheck,
    hoverClass: "hover:border-emerald-500/50 hover:bg-emerald-500/10",
  },
]

export default function LoginForm({ showGuestAccess = false }: { showGuestAccess?: boolean }) {
  const params = useSearchParams()
  const rawNext = params.get("next") || ""
  const next =
    rawNext && /^\/[a-zA-Z0-9_\-/.?=&#%]*$/.test(rawNext) && !rawNext.startsWith("//")
      ? rawNext
      : "/dashboard"
  const guestStatus = params.get("guest")
  const guestError =
    guestStatus === "unavailable"
      ? "Guest access is temporarily unavailable."
      : guestStatus === "error"
        ? "Guest sign-in failed. Please try again."
        : null

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [remember, setRemember] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(guestError)
  const [loading, setLoading] = useState(false)
  const [demoLoadingEmail, setDemoLoadingEmail] = useState<string | null>(null)

  async function handleDemoLogin(userEmail: string) {
    setError(null)
    setDemoLoadingEmail(userEmail)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({
        email: userEmail,
        password: "DemoPassword123!",
      })
      if (error) {
        setError(`Demo sign-in failed: ${error.message}`)
        setDemoLoadingEmail(null)
        return
      }
      window.location.href = next
    } catch {
      setError("Demo sign-in failed. Please try again.")
      setDemoLoadingEmail(null)
    }
  }

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
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setError("Email or password is incorrect.")
        setLoading(false)
        return
      }
      window.location.href = next
    } catch {
      setError("Sign-in failed. Please try again.")
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1.5 text-center">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">
          Sign in to your portal
        </h1>
        <p className="text-xs sm:text-sm text-slate-400 leading-relaxed text-pretty">
          Interactive showcase preview. Choose a role below for instant 1-click access:
        </p>
      </div>

      {/* ── 1-CLICK DEMO ACCESS BUTTONS ── */}
      <div className="space-y-2.5 rounded-xl border border-blue-500/25 bg-blue-950/20 p-3 backdrop-blur-md">
        <div className="flex items-center justify-between px-1 pb-1">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-blue-300">
            <Sparkles className="h-3.5 w-3.5 text-blue-400" />
            1-Click Showcase Login
          </span>
          <span className="text-[10px] text-blue-300/60 font-medium">No password needed</span>
        </div>

        <div className="grid grid-cols-1 gap-2">
          {DEMO_PERSONAS.map((persona) => {
            const Icon = persona.icon
            const isThisLoading = demoLoadingEmail === persona.email
            const isDisabled = loading || demoLoadingEmail !== null

            return (
              <button
                key={persona.email}
                type="button"
                onClick={() => handleDemoLogin(persona.email)}
                disabled={isDisabled}
                className={`group flex w-full items-center justify-between rounded-lg border border-white/10 bg-[#161f33]/80 px-3 py-2.5 text-left transition-all duration-200 ${persona.hoverClass} disabled:opacity-50`}
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/5 text-slate-200 group-hover:bg-white/10">
                    {isThisLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                    ) : (
                      <Icon className="h-4 w-4" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-white group-hover:text-blue-200">
                        {persona.title}
                      </span>
                      <span className={`rounded-full border px-1.5 py-0.2 text-[9px] font-medium leading-none ${persona.badgeClass}`}>
                        {persona.badge}
                      </span>
                    </div>
                    <p className="line-clamp-1 text-[10px] text-slate-400">
                      {persona.desc}
                    </p>
                  </div>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-white" />
              </button>
            )
          })}
        </div>
      </div>

      <div className="relative flex items-center justify-center pt-1">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-white/10" />
        </div>
        <div className="relative bg-[#111827] px-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider">
          or sign in with password
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-xs font-medium text-slate-300">
            Email
          </Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading || demoLoadingEmail !== null}
            placeholder="you@company.com"
            className="h-10 bg-black/50 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-blue-500/20 focus-visible:border-blue-500/50 transition-all text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-xs font-medium text-slate-300">
              Password
            </Label>
            <Link
              href="/auth/forgot-password"
              className="text-xs font-medium text-blue-400 hover:text-blue-300 hover:underline underline-offset-4 transition-colors"
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
              disabled={loading || demoLoadingEmail !== null}
              placeholder="Enter your password"
              className="h-10 pr-10 bg-black/50 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-blue-500/20 focus-visible:border-blue-500/50 transition-all text-sm"
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
            disabled={loading || demoLoadingEmail !== null}
            className="border-white/20 data-[state=checked]:bg-blue-500 data-[state=checked]:text-white data-[state=checked]:border-blue-500"
          />
          <Label
            htmlFor="remember"
            className="text-xs font-normal text-slate-400 cursor-pointer hover:text-slate-300 transition-colors"
          >
            Keep me signed in on this device
          </Label>
        </div>

        {error ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            <p className="text-xs text-destructive leading-snug">{error}</p>
          </div>
        ) : null}

        <Button
          type="submit"
          disabled={loading || demoLoadingEmail !== null}
          className="w-full h-10 text-sm font-semibold bg-blue-500 hover:bg-blue-600 text-white shadow-[0_0_15px_rgba(59,130,246,0.4)] hover:shadow-[0_0_25px_rgba(59,130,246,0.6)] border-none transition-all duration-300"
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

      {showGuestAccess ? (
        <div className="space-y-3 border-t border-white/10 pt-4">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-300">
              Showcase access
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Use a shared, isolated guest workspace. No password required.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <form action="/auth/guest" method="post">
              <input type="hidden" name="persona" value="manager" />
              <input type="hidden" name="next" value={next} />
              <Button
                type="submit"
                variant="outline"
                className="w-full border-blue-400/25 bg-blue-400/5 text-blue-100 hover:bg-blue-400/10 hover:text-white"
              >
                Guest manager
              </Button>
            </form>
            <form action="/auth/guest" method="post">
              <input type="hidden" name="persona" value="member" />
              <input type="hidden" name="next" value={next} />
              <Button
                type="submit"
                variant="outline"
                className="w-full border-white/15 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
              >
                Guest member
              </Button>
            </form>
          </div>
        </div>
      ) : null}

      <p className="text-center text-xs text-slate-500">
        Need an account?{" "}
        <span className="font-medium text-slate-300 hover:text-white transition-colors cursor-help">
          Ask your administrator
        </span>{" "}
        to invite you.
      </p>
    </div>
  )
}
