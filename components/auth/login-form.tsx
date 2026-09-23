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
  Mail,
  Lock,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { createClient } from "@/lib/supabase/client"

const DEMO_PERSONAS = [
  {
    role: "Super Admin",
    title: "Super Admin",
    email: "admin@zamdevai.com",
    badge: "Full Access",
    badgeClass: "border-amber-500/40 bg-amber-500/15 text-amber-300",
    desc: "Global AI rules, compliance analytics, team dispatch & billing",
    icon: ShieldCheck,
    iconBg: "bg-amber-500/15 border border-amber-500/30 text-amber-400 group-hover:bg-amber-500/25",
    hoverBorder: "hover:border-amber-500/50 hover:bg-gradient-to-r hover:from-amber-950/30 hover:to-transparent hover:shadow-[0_0_20px_rgba(245,158,11,0.12)]",
    textHover: "group-hover:text-amber-200",
  },
  {
    role: "Manager",
    title: "Operations Manager",
    email: "manager@zamdevai.com",
    badge: "Operations",
    badgeClass: "border-blue-500/40 bg-blue-500/15 text-blue-300",
    desc: "Team task dispatch, submission review & team chat",
    icon: Briefcase,
    iconBg: "bg-blue-500/15 border border-blue-500/30 text-blue-400 group-hover:bg-blue-500/25",
    hoverBorder: "hover:border-blue-500/50 hover:bg-gradient-to-r hover:from-blue-950/30 hover:to-transparent hover:shadow-[0_0_20px_rgba(59,130,246,0.12)]",
    textHover: "group-hover:text-blue-200",
  },
  {
    role: "Team Member",
    title: "Field Member",
    email: "member@zamdevai.com",
    badge: "Field Ops",
    badgeClass: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
    desc: "Assigned tasks, document uploads & instant AI scoring",
    icon: UserCheck,
    iconBg: "bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 group-hover:bg-emerald-500/25",
    hoverBorder: "hover:border-emerald-500/50 hover:bg-gradient-to-r hover:from-emerald-950/30 hover:to-transparent hover:shadow-[0_0_20px_rgba(16,185,129,0.12)]",
    textHover: "group-hover:text-emerald-200",
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
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-white">
          Sign in to your workspace
        </h1>
        <p className="text-xs sm:text-sm text-slate-400 leading-relaxed text-pretty">
          Choose a role below for instant 1-click access, or sign in manually:
        </p>
      </div>

      {/* ── 1-CLICK DEMO ACCESS BUTTONS ── */}
      <div className="space-y-2.5 rounded-2xl border border-blue-500/20 bg-gradient-to-b from-blue-950/30 to-blue-950/10 p-3.5 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
        <div className="flex items-center justify-between px-1">
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-blue-300">
            <Sparkles className="h-3.5 w-3.5 text-blue-400" />
            1-Click Showcase Personas
          </span>
          <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-300">
            No password needed
          </span>
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
                className={`group relative flex w-full items-center justify-between overflow-hidden rounded-xl border border-white/10 bg-[#141d31]/80 p-3 text-left transition-all duration-200 ${persona.hoverBorder} hover:bg-[#1a253e] disabled:opacity-50`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105 ${persona.iconBg}`}>
                    {isThisLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-white" />
                    ) : (
                      <Icon className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs sm:text-sm font-semibold text-white transition-colors ${persona.textHover}`}>
                        {persona.title}
                      </span>
                      <span className={`rounded-full border px-1.5 py-0.2 text-[9px] font-semibold leading-none ${persona.badgeClass}`}>
                        {persona.badge}
                      </span>
                    </div>
                    <p className="line-clamp-1 text-[11px] text-slate-400 group-hover:text-slate-300 transition-colors">
                      {isThisLoading ? "Signing in..." : persona.desc}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1 rounded-md border border-white/5 bg-white/5 px-2 py-1 text-[11px] font-medium text-slate-400 transition-colors group-hover:border-white/15 group-hover:bg-white/10 group-hover:text-white">
                  <span className="hidden sm:inline">Launch</span>
                  <ArrowRight className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" />
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="relative flex items-center justify-center py-0.5">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-white/10" />
        </div>
        <div className="relative bg-[#0c1220] px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          or sign in with password
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-xs font-medium text-slate-300">
            Work email
          </Label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
              <Mail className="h-4 w-4" />
            </div>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading || demoLoadingEmail !== null}
              placeholder="name@company.com"
              className="h-10.5 pl-9 rounded-xl bg-[#090e1a]/90 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-4 focus-visible:ring-blue-500/15 focus-visible:border-blue-500/70 hover:border-white/20 transition-all text-sm"
            />
          </div>
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
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
              <Lock className="h-4 w-4" />
            </div>
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading || demoLoadingEmail !== null}
              placeholder="Enter your password"
              className="h-10.5 pl-9 pr-10 rounded-xl bg-[#090e1a]/90 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-4 focus-visible:ring-blue-500/15 focus-visible:border-blue-500/70 hover:border-white/20 transition-all text-sm"
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

        <div className="flex items-center gap-2 pt-0.5">
          <Checkbox
            id="remember"
            checked={remember}
            onCheckedChange={(v) => setRemember(v === true)}
            disabled={loading || demoLoadingEmail !== null}
            className="rounded-md border-white/20 data-[state=checked]:bg-blue-600 data-[state=checked]:text-white data-[state=checked]:border-blue-600"
          />
          <Label
            htmlFor="remember"
            className="text-xs font-normal text-slate-400 cursor-pointer select-none hover:text-slate-300 transition-colors"
          >
            Keep me signed in on this device
          </Label>
        </div>

        {error ? (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 p-3"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
            <p className="text-xs text-red-300 leading-snug">{error}</p>
          </div>
        ) : null}

        <Button
          type="submit"
          disabled={loading || demoLoadingEmail !== null}
          className="w-full h-10.5 text-sm font-semibold bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl shadow-[0_4px_20px_rgba(37,99,235,0.35)] hover:shadow-[0_6px_25px_rgba(37,99,235,0.55)] border border-blue-400/20 active:scale-[0.99] transition-all duration-200"
        >
          {loading ? (
            <span className="inline-flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Signing in&hellip;
            </span>
          ) : (
            <span className="inline-flex items-center justify-center gap-2">
              Sign in to workspace
              <ArrowRight className="h-4 w-4" />
            </span>
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

